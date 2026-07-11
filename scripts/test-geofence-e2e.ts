// One-shot: create photo submissions pointing at GPS-tagged test images (match,
// mismatch, no-GPS), run each through the real worker pipeline, verify geo_verified
// lands correctly in all three cases.
import { Pool } from "pg";
import { initWorker, processSubmission } from "../worker/ingest";

const CASES = [
  { name: "match", uri: "gs://jannaadi-media/media/test-geofence-match2.jpg", expect: true },
  { name: "mismatch", uri: "gs://jannaadi-media/media/test-geofence-mismatch.jpg", expect: false },
  { name: "none", uri: "gs://jannaadi-media/media/test-geofence-none.jpg", expect: null },
];

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await initWorker();
  let failures = 0;

  for (const c of CASES) {
    const { rows: [row] } = await db.query(
      `INSERT INTO submissions (status, channel, lang, raw_text, media_uri, ward)
       VALUES ('received', 'photo', 'te', 'పెదగంట్యాడ లో గుంతలు రోడ్డు మీద', $1, 'Ward 75 - Pedagantyada')
       RETURNING id`,
      [c.uri]
    );
    const id = row.id;
    const result = await processSubmission(id);
    const { rows: [sub] } = await db.query("SELECT geo_verified FROM submissions WHERE id = $1", [id]);
    const ok = sub.geo_verified === c.expect;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.name}: geo_verified=${sub.geo_verified} (expected ${c.expect}), process=${result.status}`);
    if (!ok) failures++;
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  await db.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
