// scripts/verify.ts — R-4 post-replay verification queries
// Usage: tsx --env-file=.env.local scripts/verify.ts
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });

  // 1. Status breakdown
  const { rows: statusRows } = await pool.query(
    `SELECT status, count(*)::int AS n FROM submissions WHERE is_synthetic=true GROUP BY status ORDER BY n DESC`
  );
  console.log("\n=== Submission status breakdown ===");
  statusRows.forEach(r => console.log(`  ${r.status}: ${r.n}`));

  // 2. Cluster count
  const { rows: [clusterCount] } = await pool.query(`SELECT count(*)::int AS n FROM clusters`);
  console.log(`\n=== Total clusters formed: ${clusterCount.n} ===`);

  // 3. Top drainage clusters in Gajuwaka zone (B2 criterion)
  const { rows: drainageRows } = await pool.query(
    `SELECT title_en, ward, submission_count, last_seen::date
     FROM clusters
     WHERE category='drainage'
       AND (ward ILIKE '%Pedagantyada%' OR ward ILIKE '%Gajuwaka%' OR ward ILIKE '%Auto Nagar%'
            OR ward ILIKE '%Nadupuru%' OR ward ILIKE '%Steel Plant%' OR ward ILIKE '%Nehru Nagar%'
            OR ward ILIKE '%Tadi%' OR ward ILIKE '%Sivaji%')
     ORDER BY submission_count DESC
     LIMIT 5`
  );
  console.log("\n=== Top drainage clusters (Gajuwaka zone) ===");
  if (drainageRows.length === 0) {
    console.log("  (none yet — may need more processed rows)");
    // Fallback: show top drainage clusters globally
    const { rows: anyDrainage } = await pool.query(
      `SELECT title_en, ward, submission_count FROM clusters WHERE category='drainage' ORDER BY submission_count DESC LIMIT 5`
    );
    console.log("  Top drainage clusters (any ward):");
    anyDrainage.forEach(r => console.log(`  [${r.submission_count}] ${r.ward} — ${r.title_en}`));
  } else {
    drainageRows.forEach(r => console.log(`  [${r.submission_count}] ${r.ward} — ${r.title_en}`));
  }

  // 4. Dead-letter count
  const { rows: [dlCount] } = await pool.query(`SELECT count(*)::int AS n FROM deadletters`);
  console.log(`\n=== Dead-letters: ${dlCount.n} ===`);

  // 5. Rank weights check
  const { rows: weights } = await pool.query(`SELECT key, weight FROM rank_weights ORDER BY weight DESC`);
  console.log("\n=== Rank weights ===");
  weights.forEach(r => console.log(`  ${r.key}: ${r.weight}`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
