// worker/ingest.ts — JanNaadi processing worker
// Consumes Pub/Sub 'submissions' topic (or replay mode: rows WHERE status='received').
// Stage machine: received → transcribed → extracted → clustered → processed | failed
// Rules: every stage writes audit_events; every failure writes deadletters; nothing silent (B5–B8).
//
// Also imported by apps/web /api/ingest for DEMO_MODE synchronous processing:
// call initWorker() once, then processSubmission(id).

import { GoogleGenAI, Type } from "@google/genai";
import { SpeechClient } from "@google-cloud/speech";
import { PubSub } from "@google-cloud/pubsub";
import { Pool, PoolClient } from "pg";
import { z } from "zod";

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  // a DB restart must surface as a loud error, not a silent hang on a dead socket
  connectionTimeoutMillis: 10_000,
  query_timeout: 30_000,
  keepAlive: true,
});
db.on("error", (e) => console.error(`[worker pg pool] idle client error: ${e.message}`));
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: 45_000 } });
const stt = new SpeechClient();

// ── Config loaded from app_config at startup (B10 pattern) ──
let CFG: Record<string, string> = {};
async function loadConfig() {
  const { rows } = await db.query("SELECT key, val FROM app_config");
  CFG = Object.fromEntries(rows.map((r) => [r.key, r.val]));
}

// Idempotent init for embedding callers (DEMO_MODE route, replay, Pub/Sub main).
let initialized = false;
export async function initWorker() {
  if (initialized) return;
  await loadConfig();
  WARD_ENUM = (await db.query("SELECT name FROM wards")).rows.map((r) => r.name);
  if (!CFG.gemini_model) throw new Error("app_config.gemini_model missing — refusing to run unpinned");
  if (CFG.gemini_model.includes("latest")) throw new Error(`gemini_model must be a pinned version, got: ${CFG.gemini_model}`);
  initialized = true;
}

// ── Gemini extraction: enum-constrained, pinned model ───────
// Enums MUST mirror db/seed.sql. Ward list injected at startup from wards table.
let WARD_ENUM: string[] = [];
const CATEGORY_ENUM = ["roads","drainage","water","health","education","garbage","streetlights","other"] as const;

function extractionSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      category:         { type: Type.STRING, enum: [...CATEGORY_ENUM] },  // closed list — model can't invent
      ward:             { type: Type.STRING, enum: [...WARD_ENUM, "UNKNOWN"] },
      severity:         { type: Type.INTEGER },                           // validated 1–5 by zod below
      summary_en:       { type: Type.STRING },
      summary_original: { type: Type.STRING },
      lang:             { type: Type.STRING, enum: ["te","hi","en","mixed"] },
      grounded_lat:     { type: Type.NUMBER, nullable: true },  // from Maps grounding, null if no place resolved
      grounded_lng:     { type: Type.NUMBER, nullable: true },
    },
    required: ["category","ward","severity","summary_en","summary_original","lang"],
  };
}

// zod schema — the hard validation gate behind Gemini's responseSchema (B6).
// Ward membership is checked against the live WARD_ENUM at parse time.
const ExtractionZ = z.object({
  category: z.enum(CATEGORY_ENUM),
  ward: z.string().refine((w) => w === "UNKNOWN" || WARD_ENUM.includes(w), { message: "ward not in wards table" }),
  severity: z.number().int().min(1).max(5),
  summary_en: z.string().trim().min(1),
  summary_original: z.string(),
  lang: z.enum(["te", "hi", "en", "mixed"]),
  grounded_lat: z.number().nullable().optional(),
  grounded_lng: z.number().nullable().optional(),
});
export type Extraction = z.infer<typeof ExtractionZ>;

// T1/B14: ward UNKNOWN + grounded coords → nearest ward centroid within 4km, else null.
// Deterministic and auditable — the audit event records which path resolved the ward.
async function resolveWardFromLatLng(lat: number, lng: number): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT name, ( 6371 * acos( least(1.0,
        cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2))
        + sin(radians($1)) * sin(radians(lat)) ) ) ) AS km
     FROM wards ORDER BY km LIMIT 1`, [lat, lng]);
  return rows[0] && rows[0].km <= 4 ? rows[0].name : null;
}

const FEWSHOT = `Examples:
Input: "మా వీధిలో డ్రైనేజీ పొంగి పోతోంది, పిల్లలు స్కూల్ కి వెళ్ళలేకపోతున్నారు" (ward hint: Gajuwaka)
Output: category=drainage, ward=Gajuwaka, severity=4, lang=te
Input: "Road lo pedda gunta undi sir, accident aiyye chance" (ward hint: none)
Output: category=roads, ward=UNKNOWN, severity=4, lang=mixed
Input: "पानी की सप्लाई हफ्ते में दो दिन ही आ रही है" (ward hint: Madhurawada)
Output: category=water, ward=Madhurawada, severity=3, lang=hi`;

// One structured call + one retry-with-error-context, then dead-letter (D4, B6).
// T1: Grounding with Google Maps enabled — Gemini resolves landmark mentions
// ("near RTC complex") against real Places data (GA for India). Grounded place
// coordinates feed resolveWardFromLatLng() when ward is otherwise UNKNOWN (B14).
async function extract(subId: string, text: string, wardHint: string | null, imageUri?: string): Promise<Extraction> {
  const model = CFG.gemini_model;
  const prompt =
    `Extract structured fields from this citizen submission (Visakhapatnam). ` +
    `Ward: use the citizen-selected hint if plausible; else infer from landmarks using Maps grounding; else UNKNOWN. ` +
    `Also return grounded_lat/grounded_lng of the most specific place mentioned, or null.\n` +
    `Severity: 1 minor inconvenience … 5 safety/life risk.\n${FEWSHOT}\n\n` +
    `Ward hint: ${wardHint ?? "none"}\nSubmission: ${text}`;

  const call = async (extra = "") => {
    const t0 = Date.now();
    const parts: any[] = [{ text: prompt + extra }];
    if (imageUri) parts.unshift({ fileData: { fileUri: imageUri } }); // photo channel: multimodal
    const res = await ai.models.generateContent({
      model, contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json", responseSchema: extractionSchema(), temperature: 0.1,
        tools: [{ googleMaps: {} }],                       // Maps grounding tool
        toolConfig: { retrievalConfig: { latLng: { latitude: 17.7385, longitude: 83.2185 } } }, // bias: Vizag center
      },
    });
    const parsed = ExtractionZ.safeParse(JSON.parse(res.text!));
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), res.text!);
    return { out: parsed.data, latency: Date.now() - t0 };
  };

  try {
    const { out, latency } = await call();
    await audit(subId, "extracted", model, latency, { retry: 0 });
    return out;
  } catch (e1) {
    try {
      const { out, latency } = await call(`\n\nPrevious attempt failed validation: ${e1}. Correct and return valid JSON only.`);
      await audit(subId, "extracted", model, latency, { retry: 1 });
      return out;
    } catch (e2) {
      await deadletter(subId, "extracted", "schema_validation_failed_after_retry", e2 instanceof ValidationError ? e2.raw : String(e2));
      if (e2 instanceof Error) (e2 as any).deadlettered = true; // caller must not double-deadletter
      throw e2; // caller sets status=failed; pipeline continues with next message
    }
  }
}

class ValidationError extends Error {
  constructor(msg: string, public raw: string) { super(msg); }
}

// ── STT with confidence-floor fallback (B7) ─────────────────
// Returns null when confidence < floor → caller routes audio to Gemini multimodal direct.
// Writes to the submission row go through the tx client — the row is locked by it.
async function transcribe(subId: string, gcsUri: string, langHint: string) {
  const t0 = Date.now();
  const langMap: Record<string, string> = { te: "te-IN", hi: "hi-IN", en: "en-IN" };
  const [res] = await stt.recognize({
    audio: { uri: gcsUri },
    config: {
      languageCode: langMap[langHint] ?? "te-IN",
      alternativeLanguageCodes: ["te-IN","hi-IN","en-IN"].filter((l) => l !== langMap[langHint]),
      ...sttEncodingFor(gcsUri), model: "latest_long",
    },
  });
  const alt = res.results?.[0]?.alternatives?.[0];
  const conf = alt?.confidence ?? 0;
  await audit(subId, "transcribed", "cloud-stt", Date.now() - t0, { confidence: conf });
  return conf >= parseFloat(CFG.stt_confidence_floor) ? alt!.transcript! : null;
}

// Contract allows webm/wav/mp3 — pick STT encoding from the media extension.
// wav: omit encoding, STT reads the RIFF header. mp3: MP3 (beta, works for 60s clips).
function sttEncodingFor(uri: string): object {
  if (uri.endsWith(".webm")) return { encoding: "WEBM_OPUS", sampleRateHertz: 48000 };
  if (uri.endsWith(".mp3"))  return { encoding: "MP3", sampleRateHertz: 44100 };
  return {}; // wav/flac: header carries encoding + rate
}

// ── Cluster assignment: nearest centroid or new cluster ─────
// Runs on the tx client: cluster mutation commits/rolls back with the submission (B5).
async function assignCluster(client: PoolClient, subId: string, embedding: number[], meta: { category: string; ward: string; summary_en: string; lat: number | null; lng: number | null; submitted_at: string }) {
  const vec = `[${embedding.join(",")}]`;
  // Nearest same-category+ward centroid within threshold; ward+category gate keeps clusters explainable
  const { rows } = await client.query(
    `SELECT id, 1 - (centroid <=> $1::vector) AS sim FROM clusters
     WHERE category = $2 AND ward = $3 ORDER BY centroid <=> $1::vector LIMIT 1`,
    [vec, meta.category, meta.ward]
  );
  const threshold = parseFloat(CFG.cluster_similarity_threshold);

  if (rows[0] && rows[0].sim >= threshold) {
    // join: running-mean centroid update + counters, single transaction (idempotency: B5)
    await client.query(
      `UPDATE clusters SET
         centroid = (centroid * submission_count + $1::vector) / (submission_count + 1),
         submission_count = submission_count + 1,
         last_seen = GREATEST(last_seen, $2)
       WHERE id = $3`,
      [vec, meta.submitted_at, rows[0].id]
    );
    return rows[0].id as string;
  }
  // new cluster seeded by this submission
  const ins = await client.query(
    `INSERT INTO clusters (title_en, category, ward, centroid, centroid_lat, centroid_lng, submission_count, first_seen, last_seen)
     VALUES ($1,$2,$3,$4::vector,$5,$6,1,$7,$7) RETURNING id`,
    [meta.summary_en.slice(0, 80), meta.category, meta.ward, vec, meta.lat, meta.lng, meta.submitted_at]
  );
  return ins.rows[0].id as string;
}

// ── Per-message pipeline ─────────────────────────────────────
// All submission/cluster writes ride one transaction on a dedicated client, so the
// FOR UPDATE SKIP LOCKED row lock actually holds for the whole pipeline (B5):
// a concurrent worker skips the locked row; a mid-batch kill rolls back cleanly —
// zero lost, zero duplicated. audit_events/deadletters write via the pool on
// separate connections so the trail survives a rollback (B6, B8).
export type ProcessResult = { status: "processed"; cluster_id: string; category: string } | { status: "failed"; reason: string } | { status: "skipped" };

export async function processSubmission(subId: string): Promise<ProcessResult> {
  const client = await db.connect();
  let failReason = "pipeline_error";
  try {
    await client.query("BEGIN");
    // FOR NO KEY UPDATE (not FOR UPDATE): audit_events/deadletters INSERTs on other
    // connections FK-reference this row, and FK checks take FOR KEY SHARE — which
    // conflicts with FOR UPDATE and would block the audit trail until the tx ends.
    // NO KEY UPDATE keeps the exact same SKIP LOCKED idempotency semantics (B5).
    const { rows: [sub] } = await client.query("SELECT * FROM submissions WHERE id = $1 FOR NO KEY UPDATE SKIP LOCKED", [subId]);
    if (!sub || sub.status !== "received") { await client.query("ROLLBACK"); return { status: "skipped" }; } // idempotent: already processed or in-flight (B5)

    // 1. text acquisition per channel
    let text = sub.raw_text as string | null;
    if (sub.channel === "voice") {
      text = await transcribe(subId, sub.media_uri, sub.lang ?? "te");
      if (text) await client.query("UPDATE submissions SET transcript=$1, status='transcribed' WHERE id=$2", [text, subId]);
      // text===null → low confidence → extract() gets audio URI for multimodal direct path (B7)
    }

    // 2. extraction (multimodal when photo, or voice-fallback)
    const mediaForGemini = sub.channel === "photo" || (sub.channel === "voice" && !text) ? sub.media_uri : undefined;
    const ex = await extract(subId, text ?? sub.raw_text ?? "(media only)", sub.ward, mediaForGemini);

    // 3. embedding — once, stored, never recomputed (D: no drift)
    con