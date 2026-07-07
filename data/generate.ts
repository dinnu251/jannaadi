// data/generate.ts — JanNaadi synthetic citizen submissions
// T1 LLM-grounded generator. Output: data/synthetic.jsonl + data/synthetic_inserts.sql
// Run: GEMINI_API_KEY=... npx tsx data/generate.ts
// Cost control: batched Gemini calls (25 items/call), ~32 calls total.

import { GoogleGenAI, Type } from "@google/genai";
import { writeFileSync, appendFileSync, existsSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-2.5-flash";        // generation model; extraction pipeline pins -002
const TOTAL = 800;
const BATCH = 25;

// ── Distributions (spec from build plan) ──────────────────
// Wards: MUST match db/seed.sql. Swap both together after GVMC scrape.
const WARDS: Record<string, { lat: number; lng: number }> = {
  "Gajuwaka":        { lat: 17.6868, lng: 83.1953 },
  "Madhurawada":     { lat: 17.8262, lng: 83.3556 },
  "MVP Colony":      { lat: 17.7386, lng: 83.3350 },
  "Pendurthi":       { lat: 17.8123, lng: 83.2020 },
  "Akkayyapalem":    { lat: 17.7300, lng: 83.3000 },
  "Seethammadhara":  { lat: 17.7420, lng: 83.3180 },
  "Gopalapatnam":    { lat: 17.7660, lng: 83.2160 },
  "Kancharapalem":   { lat: 17.7350, lng: 83.2850 },
  "Maddilapalem":    { lat: 17.7350, lng: 83.3230 },
  "Rushikonda":      { lat: 17.7826, lng: 83.3850 },
  "Malkapuram":      { lat: 17.6940, lng: 83.2400 },
  "Anakapalle Road": { lat: 17.6900, lng: 83.0040 },
};

// lang: 45% te, 30% hi, 25% en; 15% of each rendered code-mixed
const LANGS = weighted([["te", 0.45], ["hi", 0.30], ["en", 0.25]]);
// channel: 60% text, 25% voice(-transcript style), 15% photo+caption
const CHANNELS = weighted([["text", 0.60], ["voice", 0.25], ["photo", 0.15]]);
// category base rates — calibrated from REAL GVMC 2026 data (7,162 complaints)
// Source: GVMC e-Governance Citizen Grievance Zone & Department Report, Year 2026
// garbage:PH-Sanitation(1639), roads:Eng-PW+AGI-PW+PL&C+Upit(1596),
// streetlights:Eng-Electrical(1214), water:Eng-WaterSupply(829),
// health:PH-depts(~574), drainage:Eng-UGD(430), other+education: residual
const CATEGORIES = weighted([
  ["garbage",      0.23],  // 1639/7162 — PH-Sanitation (was 0.12 — doubled)
  ["roads",        0.22],  // 1596/7162 — Eng-PW + AGI-PW + PL&C + Upit (was 0.30)
  ["streetlights", 0.17],  // 1214/7162 — Eng-Electrical (was 0.05 — 3× increase)
  ["water",        0.12],  // 829/7162  — Eng-Water Supply (was 0.20)
  ["health",       0.08],  // ~574/7162 — PH depts combined (was 0.15)
  ["drainage",     0.06],  // 430/7162  — Eng-UGD ✓ unchanged
  ["other",        0.08],  // ~490/7162 — Town Planning, Revenue, GVMC-IT
  ["education",    0.04],  // minimal in GVMC data; retained for demo golden-set variety
]);

// ── Hotspot injection: clusters the pipeline MUST find (B2) ──
// Overrides category+ward for a slice of rows so demand visibly concentrates.
const HOTSPOTS = [
  { ward: "Gajuwaka",     category: "drainage",     count: 60 }, // top-5 guarantee
  { ward: "Pendurthi",    category: "health",       count: 40 }, // PHC theme, demo beat G04
  { ward: "Madhurawada",  category: "water",        count: 35 },
  { ward: "Gopalapatnam", category: "streetlights", count: 25 },
];

// ── Gemini batch prompt: realistic citizen voices ─────────
const geminiSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      raw_text: { type: Type.STRING }, // the citizen's own words, native script
      severity: { type: Type.INTEGER }, // 1–5, generator's ground-truth label
    },
    required: ["raw_text", "severity"],
  },
};

async function generateBatch(specs: RowSpec[]): Promise<{ raw_text: string; severity: number }[]> {
  const lines = specs.map((s, i) =>
    `${i + 1}. lang=${s.lang}${s.mixed ? " (code-mixed with English, natural Tenglish/Hinglish)" : ""}, ` +
    `channel=${s.channel}${s.channel === "voice" ? " (spoken register: fillers, informal)" : ""}` +
    `${s.channel === "photo" ? " (short caption for an uploaded photo)" : ""}, ` +
    `category=${s.category}, ward=${s.ward}`
  ).join("\n");

  const res = await ai.models.generateContent({
    model: MODEL,
    contents:
      `Generate ${specs.length} realistic citizen complaints/development requests from Visakhapatnam, India. ` +
      `Vary length (10–80 words), tone (frustrated, polite, urgent), and specificity (some name streets/landmarks, some vague). ` +
      `Telugu in Telugu script, Hindi in Devanagari. Code-mixed = script-mixed, how real people type on WhatsApp. ` +
      `NEVER mention the category or ward name mechanically; embed naturally. Include severity 1–5 (5 = safety risk).\n\n${lines}`,
    config: { responseMimeType: "application/json", responseSchema: geminiSchema, temperature: 1.0 },
  });
  const parsed = JSON.parse(res.text!);
  if (!Array.isArray(parsed) || parsed.length !== specs.length)
    throw new Error(`batch size mismatch: got ${parsed?.length}, want ${specs.length}`); // loud, never silent
  return parsed;
}

// ── Row spec assembly ──────────────────────────────────────
type RowSpec = { lang: string; mixed: boolean; channel: string; category: string; ward: string };

function buildSpecs(): RowSpec[] {
  const specs: RowSpec[] = [];
  // 1. hotspot rows first (fixed ward+category)
  for (const h of HOTSPOTS)
    for (let i = 0; i < h.count; i++)
      specs.push({ lang: pick(LANGS), mixed: Math.random() < 0.15, channel: pick(CHANNELS), category: h.category, ward: h.ward });
  // 2. background noise fills the rest
  const wardNames = Object.keys(WARDS);
  while (specs.length < TOTAL)
    specs.push({
      lang: pick(LANGS), mixed: Math.random() < 0.15, channel: pick(CHANNELS),
      category: pick(CATEGORIES), ward: wardNames[Math.floor(Math.random() * wardNames.length)],
    });
  return shuffle(specs);
}

// ── Timestamp skew: last 90 days, recency-weighted ─────────
function skewedTimestamp(): string {
  const days = Math.floor(90 * Math.pow(Math.random(), 2)); // quadratic → recent bias
  const d = new Date(Date.now() - days * 86400_000 - Math.random() * 86400_000);
  return d.toISOString();
}

// ── Geo jitter around ward centroid (~1.5km) ───────────────
const jitter = () => (Math.random() - 0.5) * 0.027;

// ── Main ───────────────────────────────────────────────────
async function main() {
  for (const f of ["data/synthetic.jsonl", "data/synthetic_inserts.sql"])
    if (existsSync(f)) unlinkSync(f);
  writeFileSync("data/synthetic_inserts.sql",
    "-- Generated. Embeddings NULL here; ingest worker embeds on replay, OR run scripts/embed-seed.ts\n");

  const specs = buildSpecs();
  for (let i = 0; i < specs.length; i += BATCH) {
    const slice = specs.slice(i, i + BATCH);
    const texts = await retry(() => generateBatch(slice), 2); // retry batch once, then fail loud
    slice.forEach((s, j) => {
      const w = WARDS[s.ward];
      const row = {
        id: randomUUID(),
        channel: s.channel,
        lang: s.mixed ? "mixed" : s.lang,
        raw_text: texts[j].raw_text,
        category: s.category,          // ground truth — worker re-extracts; diff = extraction QA signal
        ward: s.ward,
        severity: texts[j].severity,
        lat: w.lat + jitter(), lng: w.lng + jitter(),
        submitted_at: skewedTimestamp(),
        is_synthetic: true,
      };
      appendFileSync("data/synthetic.jsonl", JSON.stringify(row) + "\n");
      appendFileSync("data/synthetic_inserts.sql",
        `INSERT INTO submissions (id,channel,lang,raw_text,category,ward,severity,lat,lng,submitted_at,is_synthetic,status)` +
        ` VALUES ('${row.id}','${row.channel}','${row.lang}',${sqlStr(row.raw_text)},'${row.category}','${row.ward}',` +
        `${row.severity},${row.lat},${row.lng},'${row.submitted_at}',true,'received');\n`);
    });
    console.log(`batch ${i / BATCH + 1}/${Math.ceil(TOTAL / BATCH)} done`);
  }
  console.log(`✓ ${TOTAL} rows → synthetic.jsonl + synthetic_inserts.sql`);
  console.log("Next: psql -f data/synthetic_inserts.sql, then run worker in replay mode to embed+cluster, then 