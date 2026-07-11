// scripts/accuracy-diff.ts — R-5: category accuracy of worker vs generate.ts ground-truth.
// Reads data/synthetic.jsonl (ground-truth) + queries DB for processed submissions.
// Outputs % accuracy for slide 4 of the deck.
//
// Usage: tsx --env-file=.env.local scripts/accuracy-diff.ts

import { createReadStream } from "fs";
import { createInterface } from "readline";
import path from "path";
import { Pool } from "pg";

function loadEnv() {
  // Already loaded by --env-file; DATABASE_URL in process.env
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });

  // 1. Load ground-truth from synthetic.jsonl
  const gt = new Map<string, string>(); // id → ground-truth category
  const jsonl = path.join(__dirname, "../data/synthetic.jsonl");
  const rl = createInterface({ input: createReadStream(jsonl), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.id && row.category) gt.set(row.id, row.category);
  }
  console.log(`Ground-truth rows: ${gt.size}`);

  // 2. Fetch worker-assigned categories for processed synthetics
  const { rows } = await pool.query(
    `SELECT id, category FROM submissions WHERE is_synthetic=true AND status='processed'`
  );
  console.log(`Processed rows in DB: ${rows.length}`);

  // 3. Diff
  let match = 0, mismatch = 0;
  const confusion: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const truth = gt.get(row.id);
    if (!truth) continue;
    const pred = row.category;
    if (pred === truth) { match++; }
    else {
      mismatch++;
      confusion[truth] ??= {};
      confusion[truth][pred] = (confusion[truth][pred] ?? 0) + 1;
    }
  }

  const total = match + mismatch;
  const pct = total ? ((match / total) * 100).toFixed(1) : "N/A";
  console.log(`\n=== ACCURACY: ${match}/${total} = ${pct}% ===\n`);

  if (mismatch > 0) {
    console.log("Top mismatches (truth → pred: count):");
    const pairs: { truth: string; pred: string; n: number }[] = [];
    for (const [truth, preds] of Object.entries(confusion))
      for (const [pred, n] of Object.entries(preds))
        pairs.push({ truth, pred, n });
    pairs.sort((a, b) => b.n - a.n).slice(0, 10).forEach(({ truth, pred, n }) =>
      console.log(`  ${truth} → ${pred}: ${n}`)
    );
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
