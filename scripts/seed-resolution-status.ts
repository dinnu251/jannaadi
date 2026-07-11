// scripts/seed-resolution-status.ts — one-time backfill for synthetic demo data.
// db/demo_seed.dump was frozen before db/trust_and_feedback.sql added
// resolution_status, so every synthetic submission defaulted to 'open'. This
// assigns a realistic open/acknowledged/in_progress/resolved mix, weighted by
// submission age (older complaints more likely resolved), so the MP dashboard
// has real resolved/in-progress data to show instead of 100% open.
// Run: DATABASE_URL=... npx tsx scripts/seed-resolution-status.ts

import { Client } from "pg";

type Status = "open" | "acknowledged" | "in_progress" | "resolved";

function pickStatus(ageDays: number): Status {
  const r = Math.random();
  let buckets: [Status, number][];
  if (ageDays > 60) buckets = [["resolved", 0.70], ["in_progress", 0.20], ["acknowledged", 0.05], ["open", 0.05]];
  else if (ageDays > 30) buckets = [["resolved", 0.40], ["in_progress", 0.30], ["acknowledged", 0.15], ["open", 0.15]];
  else if (ageDays > 7) buckets = [["resolved", 0.15], ["in_progress", 0.30], ["acknowledged", 0.25], ["open", 0.30]];
  else buckets = [["resolved", 0.05], ["in_progress", 0.10], ["acknowledged", 0.15], ["open", 0.70]];

  let acc = 0;
  for (const [status, p] of buckets) {
    acc += p;
    if (r < acc) return status;
  }
  return "open";
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query<{ id: string; submitted_at: string }>(
    `SELECT id, submitted_at FROM submissions WHERE is_synthetic = true`
  );
  console.log(`Backfilling resolution_status for ${rows.length} synthetic submissions...`);

  const now = Date.now();
  const ids: string[] = [];
  const statuses: string[] = [];
  for (const row of rows) {
    const ageDays = (now - new Date(row.submitted_at).getTime()) / 86_400_000;
    ids.push(row.id);
    statuses.push(pickStatus(ageDays));
  }

  await client.query(
    `UPDATE submissions AS s
     SET resolution_status = u.status::resolution_status_type
     FROM UNNEST($1::uuid[], $2::text[]) AS u(id, status)
     WHERE s.id = u.id`,
    [ids, statuses]
  );

  const { rows: dist } = await client.query(
    `SELECT resolution_status, count(*) FROM submissions GROUP BY resolution_status ORDER BY 1`
  );
  console.log("New distribution:", JSON.stringify(dist));

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
