// scripts/nearest-wards.ts — wards nearest a lat/lng, using the EXACT haversine
// the worker's resolveWardFromLatLng uses. Fills G11's expected_ward accept-list
// (landmark-only input near RK Beach → maps_grounding → nearest ward ≤ 4km).
// Usage: DATABASE_URL=... npx tsx scripts/nearest-wards.ts [lat] [lng] [limit]
import { Pool } from "pg";

const lat = parseFloat(process.argv[2] ?? "17.7140"); // RK Beach default
const lng = parseFloat(process.argv[3] ?? "83.3240");
const limit = parseInt(process.argv[4] ?? "6", 10);

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await db.query(
    `SELECT name, ROUND(( 6371 * acos( least(1.0,
        cos(radians($1)) * cos(radians(lat)) * cos(radians(lng) - radians($2))
        + sin(radians($1)) * sin(radians(lat)) ) ) )::numeric, 2) AS km
     FROM wards ORDER BY km LIMIT $3`, [lat, lng, limit]);
  for (const r of rows) console.log(`${r.km}km  ${r.name}${r.km <= 4 ? "" : "  (beyond 4km resolver cutoff)"}`);
  console.log("\nJSON accept-list (≤4km):");
  console.log(JSON.stringify(rows.filter((r) => r.km <= 4).map((r) => r.name)));
  await db.end();
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
