// One-shot: verify trust adjustments actually fire during real pipeline runs.
// phone_verified + geo_verified=true → positive bump. A photo with mismatched GPS →
// negative bump. Reuses the real GPS test images uploaded earlier this session.
import { Pool } from "pg";
import { initWorker, processSubmission } from "../worker/ingest";

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await initWorker();
  let failures = 0;

  const phoneGood = "+919888888801";
  const phoneBad = "+919888888802";

  // positive case: verified phone + matching GPS photo
  const { rows: [g] } = await db.query(
    `INSERT INTO submissions (status, channel, lang, raw_text, media_uri, ward, phone, phone_verified)
     VALUES ('received','photo','te','పెదగంట్యాడ లో గుంతలు రోడ్డు మీద', $1, 'Ward 75 - Pedagantyada', $2, true) RETURNING id`,
    ["gs://jannaadi-media/media/test-geofence-match2.jpg", phoneGood]
  );
  await processSubmission(g.id);
  const { rows: [tGood] } = await db.query("SELECT score FROM citizen_trust WHERE phone = $1", [phoneGood]);
  const goodOk = tGood && Number(tGood.score) > 50; // neutral start (50) + phone_verified(+2) + geo match(+3) = 55
  console.log(`${goodOk ? "PASS" : "FAIL"} positive case: score=${tGood?.score} (expected > 50)`);
  if (!goodOk) failures++;

  // negative case: verified phone but GPS mismatch photo
  const { rows: [b] } = await db.query(
    `INSERT INTO submissions (status, channel, lang, raw_text, media_uri, ward, phone, phone_verified)
     VALUES ('received','photo','te','పెదగంట్యాడ లో గుంతలు రోడ్డు మీద', $1, 'Ward 75 - Pedagantyada', $2, true) RETURNING id`,
    ["gs://jannaadi-media/media/test-geofence-mismatch.jpg", phoneBad]
  );
  await processSubmission(b.id);
  const { rows: [tBad] } = await db.query("SELECT score FROM citizen_trust WHERE phone = $1", [phoneBad]);
  const badOk = tBad && Number(tBad.score) < 50; // neutral(50) + phone_verified(+2) + geo mismatch(-3) = 49
  console.log(`${badOk ? "PASS" : "FAIL"} negative case: score=${tBad?.score} (expected < 50)`);
  if (!badOk) failures++;

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  // cleanup
  await db.query("DELETE FROM citizen_trust WHERE phone = ANY($1)", [[phoneGood, phoneBad]]);
  await db.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
