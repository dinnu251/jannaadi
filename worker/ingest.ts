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
import { GoogleAuth } from "google-auth-library";
import { Pool, PoolClient } from "pg";
import { z } from "zod";
import { createServer } from "http";
import * as exifr from "exifr";

// Read-only GCS access for inlining multimodal media (Gemini API needs inline bytes).
const mediaAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/devstorage.read_only"] });

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  // a DB restart must surface as a loud error, not a silent hang on a dead socket
  connectionTimeoutMillis: 10_000,
  query_timeout: 60_000,      // bumped: Cloud SQL proxy via local socket can lag under load
  idleTimeoutMillis: 20_000,  // recycle idle connections quickly to avoid stale sockets
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
});
db.on("error", (e) => console.error(`[worker pg pool] idle client error: ${e.message}`));
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: 45_000 } });
const stt = new SpeechClient();

// ── Config loaded from app_config at startup (B10 pattern) ──
let CFG: Record<string, string> = {};
async function loadConfig() {
  const { rows } = await db.query("SELECT key, val FROM app_config");
  CFG = Object.fromEntries(rows.map((r) => [r.key, r.val]));
  // Env var overrides — let GEMINI_MODEL pin bypass a stale app_config row without a DB migration
  if (process.env.GEMINI_MODEL) CFG.gemini_model = process.env.GEMINI_MODEL;
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

// T1/B14 grounding pre-pass: the live API rejects googleMaps tool + JSON response
// mime in ONE call, so landmark grounding runs as its own plain-text call, only
// when the ward is still unresolved. Returns Vizag-bbox-sane coords or null;
// failures are audited and never block the pipeline (ladder continues).
async function groundLandmark(subId: string, text: string): Promise<{ lat: number; lng: number } | null> {
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: CFG.gemini_model,
      contents: [{ role: "user", parts: [{ text:
        `Identify the single most specific place in Visakhapatnam mentioned in this citizen complaint. ` +
        `Reply with ONLY its coordinates as "lat,lng" (decimal degrees), or "none" if no specific place is mentioned.\n\nComplaint: ${text}` }] }],
      config: {
        temperature: 0,
        tools: [{ googleMaps: {} }],                       // Maps grounding tool (T1)
        toolConfig: { retrievalConfig: { latLng: { latitude: 17.7385, longitude: 83.2185 } } }, // bias: Vizag center
      },
    });
    const m = res.text?.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    const coords = m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
    const sane = coords && coords.lat > 17.4 && coords.lat < 18.2 && coords.lng > 82.8 && coords.lng < 83.7;
    await audit(subId, "extracted", CFG.gemini_model, Date.now() - t0, { maps_grounding_prepass: sane ? "hit" : "miss" });
    return sane ? coords! : null;
  } catch (e) {
    await audit(subId, "extracted", null, Date.now() - t0, { maps_grounding_prepass: "error", error: String(e).slice(0, 200) });
    return null;
  }
}

// Download gs:// media and return it as Gemini inlineData (base64 + mimeType).
// Authenticated GET (no @google-cloud/storage streams — same standalone-safe path
// as the uploader). Gemini API multimodal requires inline bytes, not gs:// URIs.
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webm: "audio/webm", wav: "audio/wav", mp3: "audio/mpeg",
  ogg: "audio/ogg", amr: "audio/amr", // Twilio WhatsApp voice notes / carrier MMS audio
};
async function downloadGcs(gsUri: string): Promise<Buffer> {
  const m = gsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`not a gs:// URI: ${gsUri}`);
  const [, bucket, object] = m;
  const token = await mediaAuth.getAccessToken();
  if (!token) throw new Error("downloadGcs: could not acquire access token");
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GCS download ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function inlineFromGcs(gsUri: string): Promise<{ mimeType: string; data: string }> {
  const buf = await downloadGcs(gsUri);
  const ext = gsUri.split(".").pop()?.toLowerCase() ?? "";
  return { mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream", data: buf.toString("base64") };
}

// T1.2/B-geofence: photo submissions only. Parses EXIF GPS + capture timestamp,
// compares GPS to the resolved ward's centroid (same 4km radius as the maps-grounding
// ladder). true = within radius, false = present but too far, null = no EXIF GPS
// (never penalized — most phones/apps strip location metadata by default).
// Recency (captured >30 days ago) is logged in the audit detail, not a separate flag —
// stale-but-genuine photos of an ongoing issue (e.g. a persistent pothole) are legitimate.
const GEOFENCE_RADIUS_KM = 4;
const STALE_PHOTO_DAYS = 30;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

async function checkPhotoGeofence(
  subId: string, mediaUri: string, wardName: string
): Promise<{ geoVerified: boolean | null }> {
  try {
    const buf = await downloadGcs(mediaUri);
    const gps = await exifr.gps(buf).catch(() => null); // returns null on no-GPS/parse failure, never throws upstream
    const dto: Date | undefined = (await exifr.parse(buf, ["DateTimeOriginal"]).catch(() => null))?.DateTimeOriginal;

    if (!gps || typeof gps.latitude !== "number") {
      await audit(subId, "extracted", null, null, { geofence: "no_exif_gps" });
      return { geoVerified: null };
    }
    const { rows: [w] } = await db.query("SELECT lat, lng FROM wards WHERE name = $1", [wardName]);
    if (!w) { await audit(subId, "extracted", null, null, { geofence: "ward_not_found" }); return { geoVerified: null }; }
    const km = haversineKm(gps.latitude, gps.longitude, w.lat, w.lng);
    const withinRadius = km <= GEOFENCE_RADIUS_KM;
    const staleDays = dto ? Math.floor((Date.now() - dto.getTime()) / 86_400_000) : null;
    await audit(subId, "extracted", null, null, {
      geofence: withinRadius ? "match" : "mismatch",
      distance_km: Number(km.toFixed(2)),
      ward: wardName,
      capture_stale_days: staleDays,
      capture_stale: staleDays != null && staleDays > STALE_PHOTO_DAYS,
    });
    return { geoVerified: withinRadius };
  } catch (e) {
    // Never let a geofence failure block the pipeline (B-rule: nothing silent, but
    // also nothing gates on a best-effort trust signal). Log and treat as unverified.
    await audit(subId, "extracted", null, null, { geofence: "check_error", error: String(e).slice(0, 200) });
    return { geoVerified: null };
  }
}

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

// PIN-code rung of the ward ladder: citizens who can't name a ward usually know
// their pincode. pincode_wards is built from India Post data + geocoded centroids
// (scripts/build-pincode-map.cjs). Coarser than Maps grounding (a pincode spans
// several wards) so it slots BELOW grounding but ABOVE the generic citizen hint.
// Table may not exist on an un-migrated DB — treat that as "no match", never fail.
async function resolveWardFromPincode(text: string): Promise<{ ward: string; lat: number; lng: number } | null> {
  const m = text.match(/\b(53[01]\d{3})\b/); // Vizag PIN space: 530xxx / 531xxx
  if (!m) return null;
  try {
    const { rows } = await db.query("SELECT ward, lat, lng FROM pincode_wards WHERE pincode = $1", [m[1]]);
    return rows[0] ?? null;
  } catch { return null; }
}

// Ward examples MUST be valid values from the wards table (98-ward GVMC list).
const FEWSHOT = `Examples:
Input: "మా వీధిలో డ్రైనేజీ పొంగి పోతోంది, పిల్లలు స్కూల్ కి వెళ్ళలేకపోతున్నారు" (ward hint: Ward 75 - Pedagantyada)
Output: category=drainage, ward=Ward 75 - Pedagantyada, severity=4, lang=te
Input: "Road lo pedda gunta undi sir, accident aiyye chance" (ward hint: none)
Output: category=roads, ward=UNKNOWN, severity=4, lang=mixed
Input: "पानी की सप्लाई हफ्ते में दो दिन ही आ रही है" (ward hint: Ward 25 - Madhura Nagar)
Output: category=water, ward=Ward 25 - Madhura Nagar, severity=3, lang=hi`;

// One structured call + one retry-with-error-context, then dead-letter (D4, B6).
// T1: Grounding with Google Maps enabled — Gemini resolves landmark mentions
// ("near RTC complex") against real Places data (GA for India). Grounded place
// coordinates feed resolveWardFromLatLng() when ward is otherwise UNKNOWN (B14).
async function extract(subId: string, text: string, wardHint: string | null, imageUri?: string): Promise<Extraction> {
  const model = CFG.gemini_model;
  const prompt =
    `Extract structured fields from this citizen submission (Visakhapatnam). ` +
    `Ward: use the citizen-selected hint if plausible. If there is no hint, return UNKNOWN unless the ` +
    `submission explicitly names one of the listed ward areas — NEVER guess a ward from landmarks or ` +
    `streets (landmark resolution happens in a separate Maps-grounded step). ` +
    `Also return grounded_lat/grounded_lng of the most specific place mentioned, or null.\n` +
    `Severity: 1 minor inconvenience … 5 safety/life risk.\n${FEWSHOT}\n\n` +
    `Ward hint: ${wardHint ?? "none"}\nSubmission: ${text}`;

  // The Gemini API (unlike Vertex) does not accept gs:// fileData URIs — multimodal
  // media must be inlined as base64. Downloaded once per extract() call, reused on retry.
  const inline = imageUri ? await inlineFromGcs(imageUri) : null;
  const call = async (extra = "") => {
    const t0 = Date.now();
    const parts: any[] = [{ text: prompt + extra }];
    if (inline) parts.unshift({ inlineData: inline }); // photo channel (or voice-fallback): multimodal
    // NOTE: googleMaps grounding tool cannot be combined with responseMimeType: "application/json"
    // (API returns INVALID_ARGUMENT). Maps grounding is architecturally wired (T1) but runs as a
    // separate pre-pass when needed; for structured extraction we rely on JSON mode + ward resolution ladder.
    const res = await ai.models.generateContent({
      model, contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json", responseSchema: extractionSchema(), temperature: 0.1,
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
  if (uri.endsWith(".ogg"))  return { encoding: "OGG_OPUS", sampleRateHertz: 48000 };  // WhatsApp voice notes (Twilio)
  if (uri.endsWith(".mp3"))  return { encoding: "MP3", sampleRateHertz: 44100 };
  if (uri.endsWith(".amr"))  return { encoding: "AMR", sampleRateHertz: 8000 };         // some carrier MMS audio
  return {}; // wav/flac: header carries encoding + rate
}

// ── Citizen trust score (PROMPTS.md task 15): hidden reputation, phone-keyed ──
// NEVER exposed via any API response — read only by rank.sql's frequency gate
// (apps/web/app/api/rank fetches low-trust phones and excludes their submissions
// from a cluster's counted frequency, rather than adding a visible 5th ranking
// dimension). Starts neutral (50), clamped [0,100].
async function adjustTrust(phone: string | null, delta: number): Promise<void> {
  if (!phone) return;
  await db.query(
    `INSERT INTO citizen_trust (phone, score, updated_at) VALUES ($1, LEAST(100, GREATEST(0, 50 + $2)), now())
     ON CONFLICT (phone) DO UPDATE SET score = LEAST(100, GREATEST(0, citizen_trust.score + $2)), updated_at = now()`,
    [phone, delta]
  );
}

// ── AI dedup (PROMPTS.md task 16): near-identical resubmission detection ────
// Scoped to a known submitter (phone or Google user_id — the two queryable identity
// signals on submissions; anonymous Twilio senders are deliberately not persisted
// with a raw phone, so they're out of scope here by the same privacy design as
// lib/twilio.ts's senderRef). Threshold is much stricter than cluster-join (0.83):
// dedup means "the same complaint, re-sent," not "a similar complaint nearby."
const DEDUP_SIMILARITY_THRESHOLD = 0.95;
const DEDUP_WINDOW_HOURS = 24;

async function findDuplicate(
  client: PoolClient, subId: string, embedding: number[], phone: string | null, userId: string | null
): Promise<string | null> {
  if (!phone && !userId) return null;
  const vec = `[${embedding.join(",")}]`;
  const { rows } = await client.query(
    `SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM submissions
     WHERE status = 'processed' AND id != $2 AND embedding IS NOT NULL
       AND submitted_at > now() - interval '${DEDUP_WINDOW_HOURS} hours'
       AND ((phone IS NOT NULL AND phone = $3) OR (user_id IS NOT NULL AND user_id = $4))
     ORDER BY embedding <=> $1::vector LIMIT 1`,
    [vec, subId, phone, userId]
  );
  return rows[0] && rows[0].sim >= DEDUP_SIMILARITY_THRESHOLD ? rows[0].id : null;
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
    // Running-mean centroid update computed in TS: pgvector has no vector*scalar operator.
    // Fetch current centroid + count, compute new mean, write back as a pre-computed vector.
    const { rows: [existing] } = await client.query(
      `SELECT centroid, submission_count FROM clusters WHERE id = $1`, [rows[0].id]
    );
    const n: number = existing.submission_count;
    const oldC: number[] = JSON.parse(existing.centroid as string); // pg returns vector as "[...]" string
    const newVec = `[${oldC.map((v, i) => (v * n + embedding[i]) / (n + 1)).join(",")}]`;
    await client.query(
      `UPDATE clusters SET
         centroid = $1::vector,
         submission_count = submission_count + 1,
         last_seen = GREATEST(last_seen, $2)
       WHERE id = $3`,
      [newVec, meta.submitted_at, rows[0].id]
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
export type ProcessResult = { status: "processed"; cluster_id: string | null; category: string; ward: string; duplicate_of: string | null } | { status: "failed"; reason: string } | { status: "skipped" };

export async function processSubmission(subId: string): Promise<ProcessResult> {
  const client = await db.connect();
  let failReason = "pipeline_error";
  let subPhone: string | null = null; // hoisted for the catch block's trust penalty
  try {
    await client.query("BEGIN");
    // FOR NO KEY UPDATE (not FOR UPDATE): audit_events/deadletters INSERTs on other
    // connections FK-reference this row, and FK checks take FOR KEY SHARE — which
    // conflicts with FOR UPDATE and would block the audit trail until the tx ends.
    // NO KEY UPDATE keeps the exact same SKIP LOCKED idempotency semantics (B5).
    const { rows: [sub] } = await client.query("SELECT * FROM submissions WHERE id = $1 FOR NO KEY UPDATE SKIP LOCKED", [subId]);
    if (!sub || sub.status !== "received") { await client.query("ROLLBACK"); return { status: "skipped" }; } // idempotent: already processed or in-flight (B5)
    subPhone = sub.phone;

    // 1. text acquisition per channel
    let text = sub.raw_text as string | null;
    if (sub.channel === "voice" && sub.media_uri) {
      // media_uri may be null for synthetic rows — skip STT, use raw_text directly (B7 still exercised via text path)
      text = await transcribe(subId, sub.media_uri, sub.lang ?? "te");
      if (text) await client.query("UPDATE submissions SET transcript=$1, status='transcribed' WHERE id=$2", [text, subId]);
      // text===null → low confidence → extract() gets audio URI for multimodal direct path (B7)
    }

    // 2. extraction (multimodal when photo, or voice-fallback with real media_uri)
    const mediaForGemini = sub.channel === "photo" || (sub.channel === "voice" && !text && sub.media_uri) ? sub.media_uri : undefined;
    const ex = await extract(subId, text ?? sub.raw_text ?? "(media only)", sub.ward, mediaForGemini);

    // 3. embedding — once, stored, never recomputed (D: no drift)
    const emb = await ai.models.embedContent({ model: "gemini-embedding-001", contents: ex.summary_en, config: { outputDimensionality: 768 } });
    const embedding = emb.embeddings![0].values!;

    // 4. ward resolution ladder (B14): extraction → Maps-grounded coords → PIN code
    //    → citizen hint → dead-letter
    let ward: string | null = ex.ward !== "UNKNOWN" ? ex.ward : null;
    let wardPath = "extraction";
    let grounded: { lat: number; lng: number } | null =
      ex.grounded_lat != null && ex.grounded_lng != null ? { lat: ex.grounded_lat, lng: ex.grounded_lng } : null;
    if (!ward) {
      // Maps grounding pre-pass (separate call — the live API rejects the Maps tool
      // combined with JSON mode). Real Places data takes priority over the model's
      // unverified grounded_lat/lng world knowledge; those are only the fallback.
      grounded = (await groundLandmark(subId, text ?? sub.raw_text ?? "")) ?? grounded;
      if (grounded) {
        ward = await resolveWardFromLatLng(grounded.lat, grounded.lng);
        if (ward) wardPath = "maps_grounding";
      }
    }
    if (!ward) {
      // PIN-code rung: "530044" in the text resolves via India Post data even when
      // no landmark grounds. The pincode centroid also seeds the heatmap location.
      const pin = await resolveWardFromPincode(text ?? sub.raw_text ?? "");
      if (pin) { ward = pin.ward; wardPath = "pincode"; grounded = grounded ?? { lat: pin.lat, lng: pin.lng }; }
    }
    if (!ward && sub.ward) { ward = sub.ward; wardPath = "citizen_hint"; }
    if (!ward) {
      failReason = "ward_unresolvable";
      await deadletter(subId, "extracted", "ward_unresolvable", ex.summary_en);
      throw Object.assign(new Error("ward_unresolvable"), { deadlettered: true });
    }
    await audit(subId, "extracted", null, null, { ward_resolved_via: wardPath });

    // 4b. location ladder for heatmap: grounded place → submitted coords → ward centroid + jitter
    let lat: number | null = sub.lat, lng: number | null = sub.lng;
    if (grounded) { lat = grounded.lat; lng = grounded.lng; }
    if (lat == null || lng == null) {
      const { rows: [w] } = await client.query("SELECT lat, lng FROM wards WHERE name=$1", [ward]);
      lat = w.lat + (Math.random() - 0.5) * 0.01; lng = w.lng + (Math.random() - 0.5) * 0.01;
    }

    // 4c. EXIF geofencing (PROMPTS.md task 14, photo submissions only) — best-effort,
    // never blocks the pipeline; runs outside the tx client since it's read-only + audit.
    let geoVerified: boolean | null = null;
    if (sub.channel === "photo" && sub.media_uri) {
      geoVerified = (await checkPhotoGeofence(subId, sub.media_uri, ward)).geoVerified;
    }

    // 4d. AI dedup (task 16): a near-identical resubmission skips cluster assignment
    // entirely (duplicate_of set instead) — it still reaches status=processed (the
    // citizen's complaint was heard), it just doesn't inflate a cluster's frequency.
    const duplicateOf = await findDuplicate(client, subId, embedding, sub.phone, sub.user_id);
    if (duplicateOf) await audit(subId, "extracted", null, null, { duplicate_of: duplicateOf });

    // 5. cluster + finalize, same transaction
    const clusterId = duplicateOf ? null : await assignCluster(client, subId, embedding, { category: ex.category, ward, summary_en: ex.summary_en, lat, lng, submitted_at: sub.submitted_at });
    await client.query(
      `UPDATE submissions SET category=$1, ward=$2, severity=$3, summary_en=$4, summary_original=$5,
         lang=$6, embedding=$7::vector, cluster_id=$8, lat=$9, lng=$10, geo_verified=$11, duplicate_of=$12,
         status='processed', processed_at=now() WHERE id=$13`,
      [ex.category, ward, ex.severity, ex.summary_en, ex.summary_original, ex.lang, `[${embedding.join(",")}]`, clusterId, lat, lng, geoVerified, duplicateOf, subId]
    );
    await client.query("COMMIT");
    await audit(subId, "processed", null, null, { cluster_id: clusterId });

    // Trust adjustment (task 15) — best-effort, outside the tx (already committed).
    // phoneVerified and geoVerified are independent positive/negative signals;
    // a flagged duplicate is penalized regardless (spam/noise signal either way).
    if (sub.phone_verified) await adjustTrust(subPhone, 2);
    if (geoVerified === true) await adjustTrust(subPhone, 3);
    if (geoVerified === false) await adjustTrust(subPhone, -3);
    if (duplicateOf) await adjustTrust(subPhone, -5);

    return { status: "processed", cluster_id: clusterId, category: ex.category, ward, duplicate_of: duplicateOf };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    // deadletter already written at the failure site (pool connection — survives rollback).
    // Transcribe/embed/unknown failures haven't dead-lettered yet — write one so nothing is silent (B6).
    if (failReason === "pipeline_error" && !(e as any)?.deadlettered) await deadletter(subId, "extracted", "pipeline_error", String(e));
    await db.query("UPDATE submissions SET status='failed' WHERE id=$1", [subId]);
    await adjustTrust(subPhone, -5); // failed/dead-lettered submission — weak negative signal
    return { status: "failed", reason: failReason === "pipeline_error" ? String(e) : failReason }; // never rethrow — next message proceeds
  } finally {
    client.release();
  }
}

// ── Entrypoints ──────────────────────────────────────────────
async function main() {
  await initWorker();

  if (process.env.REPLAY === "true") {
    // Reset any synthetics that failed a previous replay attempt — makes replay fully idempotent
    const { rowCount: resetCount } = await db.query(
      "UPDATE submissions SET status='received' WHERE is_synthetic=true AND status='failed'"
    );
    if (resetCount && resetCount > 0) console.log(`replay: reset ${resetCount} previously-failed synthetic rows → received`);

    // Replay mode: process seeded synthetic rows like live traffic (exercises pipeline 800×)
    const { rows } = await db.query("SELECT id FROM submissions WHERE status='received' ORDER BY submitted_at");
    let ok = 0, failed = 0;
    for (const r of rows) {
      const res = await processSubmission(r.id);
      if (res.status === "processed") ok++;
      else if (res.status === "failed") { failed++; console.error(`replay: ${r.id} failed: ${(res as any).reason}`); }
    }
    console.log(`replay done: ${rows.length} rows (${ok} processed, ${failed} dead-lettered)`);
    await runPlanMatch(); // T3/B15: post-clustering batch — never inline with ingest
    await db.end();
    return;
  }
  // Pub/Sub mode: a streaming PULL subscription — a persistent background listener,
  // not an HTTP server. Cloud Run services require the container to bind $PORT and
  // pass a startup probe regardless of workload type, so this opens a trivial HTTP
  // listener purely to satisfy that (--min-instances 1 --no-cpu-throttling keeps the
  // process always-on; the actual work happens in the message handler below).
  await new Promise<void>((resolve) => {
    createServer((_req, res) => { res.writeHead(200); res.end("ok"); })
      .listen(parseInt(process.env.PORT ?? "8080", 10), () => resolve());
  });

  const sub = new PubSub().subscription("submissions-worker");
  sub.on("message", async (msg) => {
    try { await processSubmission(JSON.parse(msg.data.toString()).submission_id); msg.ack(); }
    catch (e) { console.error(`worker: ${e}`); msg.nack(); } // redeliver; FOR UPDATE SKIP LOCKED + status check make retry safe
  });
  sub.on("error", (e) => console.error(`subscription error: ${e}`));
  console.log("worker listening");
}

// T3: plan-match batch after replay. Datastore when configured, else the LOCAL
// plan_documents fallback (real PIB/PPP Vizag data). A Search outage or missing
// corpus logs loudly and never touches ingest (B15).
async function runPlanMatch() {
  try {
    const { runPlanMatchBatch } = await import("./planmatch.js");
    await runPlanMatchBatch();
  } catch (e) {
    console.error(`planmatch batch failed (ingest unaffected): ${e}`);
  }
}

// ── Audit + deadletter helpers ───────────────────────────────
// Pool connections, deliberately outside the pipeline transaction: the audit trail
// and dead letters must survive a rollback.
const audit = (subId: string, stage: string, model: string | null, latency: number | null, detail: object) =>
  db.query("INSERT INTO audit_events (submission_id, stage, model, latency_ms, detail) VALUES ($1,$2,$3,$4,$5)",
    [subId, stage, model, latency, JSON.stringify(detail)]);

const deadletter = (subId: string, stage: string, reason: string, raw: string) =>
  db.query("INSERT INTO deadletters (submission_id, failed_stage, reason, raw_response) VALUES ($1,$2,$3,$4)",
    [subId, stage, reason, raw.slice(0, 4000)]);

// Run main() only when executed directly (tsx worker/ingest.ts) — importing this
// module from the Next.js DEMO_MODE route must not start a Pub/Sub listener.
const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (entry.endsWith("worker/ingest.ts") || entry.endsWith("worker/ingest.js")) {
  main().catch((e) => { console.error(`worker fatal: ${e}`); process.exit(1); });
}
