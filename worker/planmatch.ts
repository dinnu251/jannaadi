// worker/planmatch.ts — T3: match clusters against local development plans
// Vertex AI Search datastore over 2–3 public Vizag dev-plan PDFs (GVMC budget,
// VMRDA master plan excerpts). 10K free queries/month covers demo + pilot easily.
//
// Setup (one-time, human): Discovery Engine API → create unstructured datastore
// "vizag-dev-plans" in asia-south1 → upload PDFs via console. Datastore ID in env.
//
// Runs post-clustering (replay end or nightly in prod), never inline with ingest —
// a Search outage cannot block citizen submissions. Additive to /api/rank via
// clusters.plan_match; contract tag bumped to contract-v1.1.

import { Pool } from "pg";
import { GoogleAuth } from "google-auth-library";
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const PROJECT = process.env.GCP_PROJECT!;
const DATASTORE = process.env.PLAN_DATASTORE_ID!; // e.g. vizag-dev-plans
const ENDPOINT = `https://discoveryengine.googleapis.com/v1/projects/${PROJECT}/locations/global/collections/default_collection/dataStores/${DATASTORE}/servingConfigs/default_search:search`;

// Match one cluster's summary against plan documents. Returns top hit or null.
async function searchPlans(queryText: string, token: string) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: queryText,
      pageSize: 1,
      contentSearchSpec: { snippetSpec: { returnSnippet: true } },
    }),
  });
  if (!res.ok) throw new Error(`plan search ${res.status}: ${await res.text()}`); // loud, never silent
  const data: any = await res.json();
  const hit = data.results?.[0];
  if (!hit) return null;
  return {
    doc_title: hit.document?.derivedStructData?.title ?? "plan document",
    snippet: hit.document?.derivedStructData?.snippets?.[0]?.snippet ?? null,
    relevance: hit.modelScores?.relevance_score?.values?.[0] ?? null,
  };
}

// Batch pass over clusters missing a plan_match. Idempotent — re-run safe.
// Returns how many clusters were searched — 0 means an empty/unindexed datastore,
// which the caller uses to decide whether to fall back to the local corpus.
export async function matchClusters(token: string): Promise<{ searched: number; matched: number }> {
  const { rows } = await db.query(
    `SELECT id, title_en, category, ward FROM clusters WHERE plan_match IS NULL ORDER BY submission_count DESC LIMIT 50`);
  let matched = 0;
  for (const c of rows) {
    try {
      const hit = await searchPlans(`${c.category} ${c.ward} ${c.title_en}`, token);
      await db.query(`UPDATE clusters SET plan_match = $1 WHERE id = $2`,
        [JSON.stringify(hit ?? { none: true }), c.id]); // {none:true} marks "searched, no hit" — prevents re-query
      if (hit) matched++;
    } catch (e) {
      console.error(`planmatch failed for cluster ${c.id}: ${e}`); // logged, batch continues
    }
  }
  console.log(`planmatch: ${matched}/${rows.length} clusters matched (datastore)`);
  return { searched: rows.length, matched };
}

// ── LOCAL fallback: match against db plan_documents (real Vizag data from
// data/source_data/, loaded via db/plan_documents.sql). Used when no Discovery
// Engine datastore is configured — same output shape, source is real PIB/PPP docs.
// Scoring: ward tag 0.5 + sector→category 0.3 + title-keyword overlap ≤0.2.
// A hit requires sector relevance (necessary condition) so a bare ward-tag overlap
// can't declare, say, a garbage cluster "in" an electric-bus plan. Sector lists are
// tight — deliberately no broad bridges like "environment"/"smart cities".
const SECTOR_CATEGORY: Record<string, string[]> = {
  drainage: ["drainage", "sewerage", "urban water management", "storm water"],
  water: ["water supply", "urban water management"],
  roads: ["roads", "urban transport", "railways", "freight transport", "highways"],
  health: ["health", "hospitals"],
  education: ["education", "schools"],
  garbage: ["sanitation", "waste management"],
  streetlights: ["clean energy", "power", "street lighting"],
};
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3));

export async function matchClustersLocal() {
  const { rows: docs } = await db.query("SELECT * FROM plan_documents");
  if (!docs.length) throw new Error("planmatch-local: plan_documents is empty — run scripts/build-plan-sources.ts + psql -f db/plan_documents.sql");
  const { rows: clusters } = await db.query(
    `SELECT id, title_en, category, ward FROM clusters WHERE plan_match IS NULL ORDER BY submission_count DESC LIMIT 200`);
  let matched = 0;
  for (const c of clusters) {
    try {
      const catSectors = SECTOR_CATEGORY[c.category] ?? [];
      const titleToks = tokens(c.title_en);
      let best: { score: number; doc: any; sectorMatch: boolean } | null = null;
      for (const d of docs) {
        let score = 0;
        if ((d.wards as string[]).includes(c.ward)) score += 0.5;
        const docSectors = (d.sectors as string[]).map((s: string) => s.toLowerCase());
        const sectorMatch = docSectors.some((s: string) => catSectors.some((cs) => s.includes(cs) || cs.includes(s)));
        if (sectorMatch) score += 0.3;
        const docToks = tokens(`${d.doc_title} ${d.body}`);
        const overlap = [...titleToks].filter((t) => docToks.has(t)).length;
        score += Math.min(0.2, overlap * 0.05);
        if (!best || score > best.score) best = { score, doc: d, sectorMatch };
      }
      // Require sector relevance AND a ward or keyword signal (score ≥ 0.6) — a bare
      // ward-tag (0.5) or bare sector (0.3) alone is too weak to badge as "in a plan".
      const hit = best && best.sectorMatch && best.score >= 0.6
        ? { doc_title: best.doc.doc_title, snippet: snippetOf(String(best.doc.body)), relevance: Number(best.score.toFixed(2)) }
        : null;
      await db.query(`UPDATE clusters SET plan_match = $1 WHERE id = $2`,
        [JSON.stringify(hit ?? { none: true }), c.id]); // {none:true} = searched, no hit
      if (hit) matched++;
    } catch (e) {
      console.error(`planmatch-local failed for cluster ${c.id}: ${e}`); // logged, batch continues
    }
  }
  console.log(`planmatch-local: ${matched}/${clusters.length} clusters matched against ${docs.length} real plan documents`);
}

// Dashboard-facing snippet: up to ~400 chars, cut at a sentence end when one lands
// in the back half, else at a word boundary, with an ellipsis when truncated. The
// old hard slice(0,200) chopped mid-word ("aims to decarboniz") — bad demo optics.
function snippetOf(body: string, max = 400): string {
  const text = body.trim();
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const lastSentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (lastSentence > max * 0.5) return window.slice(0, lastSentence + 1);
  const lastSpace = window.lastIndexOf(" ");
  return (lastSpace > 0 ? window.slice(0, lastSpace) : window) + "…";
}

// Entry point used by worker/ingest.ts after replay (and nightly in prod).
// Datastore path when PLAN_DATASTORE_ID is set (ADC token, fails loudly on missing
// creds); otherwise — or when the datastore is empty/unindexed and matches nothing —
// the local plan_documents fallback (real PIB/PPP data). Never a silent no-op.
export async function runPlanMatchBatch() {
  if (!process.env.PLAN_DATASTORE_ID) {
    console.warn("planmatch: PLAN_DATASTORE_ID not set — using LOCAL plan_documents fallback (real PIB/PPP source data)");
    await matchClustersLocal();
    return;
  }
  if (!process.env.GCP_PROJECT) throw new Error("planmatch: GCP_PROJECT not set");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("planmatch: could not acquire access token (check ADC / service account)");
  const { searched, matched } = await matchClusters(token);
  // Empty/unindexed datastore (searched but 0 hits) → reset those sentinels and use
  // the local corpus so B15 works with real data now, auto-upgrading once PDFs index.
  if (searched > 0 && matched === 0) {
    console.warn("planmatch: datastore returned 0 matches (likely empty/unindexed) — falling back to LOCAL plan_documents");
    await db.query(`UPDATE clusters SET plan_match = NULL WHERE plan_match = '{"none":true}'::jsonb`);
    await matchClustersLocal();
  }
}

/* Schema addition (applied in db/seed.sql tail):
   ALTER TABLE clusters ADD COLUMN plan_match JSONB;
   /api/rank passes plan_match through when non-null and not {none:true}.
   Dashboard: saffron "In dev plan" badge with snippet tooltip (F14). */
