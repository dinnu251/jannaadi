// One-shot: verify AI dedup (task 16) — same phone + near-identical text within the
// window dedupes (cluster_id=null, duplicate_of set); different phone does not.
import { Pool } from "pg";
import { initWorker, processSubmission } from "../worker/ingest";

async function submit(db: Pool, phone: string | null, text: string) {
  const { rows: [row] } = await db.query(
    `INSERT INTO submissions (status, channel, lang, raw_text, ward, phone, phone_verified)
     VALUES ('received', 'text', 'te', $1, 'Ward 75 - Pedagantyada', $2::text, $3)  RETURNING id`,
    [text, phone, phone !== null]
  );
  return { id: row.id, result: await processSubmission(row.id) };
}

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await initWorker();
  let failures = 0;

  const text = "పెదగంట్యాడ లో డ్రైనేజీ పొంగి రోడ్డంతా మురుగునీరు నిండిపోయింది, దోమలు విపరీతంగా పెరిగిపోయాయి";
  const textSimilar = "పెదగంట్యాడ లో డ్రైనేజీ పొంగి రోడ్డంతా మురుగునీరు నిండిపోయింది, దోమలు చాలా ఎక్కువగా వచ్చాయి"; // near-identical

  // 1: original from phone A
  const a1 = await submit(db, "+919000000001", text);
  console.log(`a1: ${a1.result.status === "processed" ? `cluster=${a1.result.cluster_id} dup=${a1.result.duplicate_of}` : JSON.stringify(a1.result)}`);

  // 2: near-identical resubmission from the SAME phone A → should dedupe
  const a2 = await submit(db, "+919000000001", textSimilar);
  const a2ok = a2.result.status === "processed" && a2.result.cluster_id === null && a2.result.duplicate_of === a1.id;
  console.log(`${a2ok ? "PASS" : "FAIL"} a2 (same phone, near-identical): ${a2.result.status === "processed" ? `cluster=${a2.result.cluster_id} dup=${a2.result.duplicate_of}` : JSON.stringify(a2.result)}`);
  if (!a2ok) failures++;

  // 3: near-identical text from a DIFFERENT phone B → must NOT dedupe (real second complaint)
  const b1 = await submit(db, "+919000000002", textSimilar);
  const b1ok = b1.result.status === "processed" && b1.result.cluster_id !== null && b1.result.duplicate_of === null;
  console.log(`${b1ok ? "PASS" : "FAIL"} b1 (different phone, similar text): ${b1.result.status === "processed" ? `cluster=${b1.result.cluster_id} dup=${b1.result.duplicate_of}` : JSON.stringify(b1.result)}`);
  if (!b1ok) failures++;

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  await db.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
