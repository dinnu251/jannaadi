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
export async function matchClusters(token: string) {
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
  console.log(`planmatch: ${matched}/${rows.length} clusters matched`);
}

// Entry point used by worker/ingest.ts after replay (and nightly in prod).
// Acquires an ADC access token (service account on Cloud Run, gcloud locally),
// fails loudly if env/credential