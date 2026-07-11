// scripts/build-pincode-map.cjs — PIN code → ward mapping to shrink ward_unresolvable.
//
// Citizens who can't name their ward almost always know their PIN code. This builds a
// lookup: for every plausible Vizag pincode, (1) confirm it's a real Visakhapatnam
// pincode via India Post's public API (api.postalpincode.in — official data, no key),
// (2) geocode the pincode centroid with the server Maps key, (3) snap to the nearest
// ward centroid within 6 km (pincode zones are coarser than wards — this is a
// last-resort ladder rung, not precision geography). Writes data/pincode_wards.json
// and upserts the pincode_wards table (created if missing).
//
// Run: node scripts/build-pincode-map.cjs   (idempotent; re-run any time)
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^GOOGLE_MAPS_SERVER_KEY="([^"]+)"/m) ?? env.match(/^GOOGLE_MAPS_API_KEY="([^"]+)"/m))[1];
const DBURL = env.match(/^DATABASE_URL="([^"]+)"/m)[1];
const WARDS = JSON.parse(fs.readFileSync(path.join(ROOT, "data/wards_clean.json"), "utf8"));

// GVMC city core is 530001–530053; selected 531xxx codes are GVMC too (Bheemili,
// Pendurthi belts). Non-GVMC codes are filtered naturally by the 6 km ward gate.
const CANDIDATES = [];
for (let p = 530001; p <= 530053; p++) CANDIDATES.push(String(p));
for (const p of ["531162", "531163", "531173", "531219"]) CANDIDATES.push(p);

const R = 6371, rad = Math.PI / 180;
const km = (a, b, c, d) => {
  const x = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(x));
};
const nearestWard = (lat, lng) => {
  let best = null, bestKm = Infinity;
  for (const w of WARDS) {
    const d = km(lat, lng, w.lat, w.lng);
    if (d < bestKm) { bestKm = d; best = w; }
  }
  return { ward: best.name, km: bestKm };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postOffices(pin) {
  try {
    const j = await (await fetch(`https://api.postalpincode.in/pincode/${pin}`)).json();
    const rec = Array.isArray(j) ? j[0] : null;
    if (rec?.Status !== "Success" || !rec.PostOffice) return null;
    const vizag = rec.PostOffice.filter((po) => /visakhapatnam/i.test(po.District ?? ""));
    return vizag.length ? vizag.map((po) => po.Name) : null;
  } catch { return null; }
}

async function geocodePin(pin) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?components=postal_code:${pin}|country:IN&key=${KEY}`;
  const j = await (await fetch(url)).json();
  if (j.status === "REQUEST_DENIED" || j.status === "OVER_QUERY_LIMIT") throw new Error(`Geocoding ${j.status}: ${j.error_message ?? ""}`);
  const res = j.results?.[0];
  if (j.status !== "OK" || !res) return null;
  const { lat, lng } = res.geometry.location;
  // Vizag sanity box (mirrors worker/ingest.ts)
  if (!(lat > 17.4 && lat < 18.2 && lng > 82.8 && lng < 83.7)) return null;
  return { lat, lng };
}

(async () => {
  const out = [];
  let skippedPO = 0, skippedGeo = 0, skippedFar = 0;
  for (const pin of CANDIDATES) {
    const pos = await postOffices(pin);
    if (!pos) { skippedPO++; continue; }              // not a Visakhapatnam pincode
    const geo = await geocodePin(pin);
    await sleep(60);
    if (!geo) { skippedGeo++; console.log(`  ! ${pin}: no geocode inside Vizag bbox (${pos.slice(0,2).join(", ")})`); continue; }
    const { ward, km: dist } = nearestWard(geo.lat, geo.lng);
    if (dist > 6) { skippedFar++; console.log(`  ! ${pin}: nearest ward ${dist.toFixed(1)}km away — outside GVMC, skipped`); continue; }
    out.push({ pincode: pin, ward, lat: geo.lat, lng: geo.lng, km_to_ward: +dist.toFixed(2), post_offices: pos.slice(0, 6) });
    console.log(`  ✓ ${pin} → ${ward} (${dist.toFixed(1)}km; ${pos[0]}${pos.length > 1 ? ` +${pos.length - 1}` : ""})`);
  }

  fs.writeFileSync(path.join(ROOT, "data/pincode_wards.json"), JSON.stringify(out, null, 2));

  const c = new Client({ connectionString: DBURL });
  await c.connect();
  await c.query(`CREATE TABLE IF NOT EXISTS pincode_wards (
    pincode      TEXT PRIMARY KEY,
    ward         TEXT NOT NULL REFERENCES wards(name),
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    post_offices TEXT
  )`);
  for (const r of out) {
    await c.query(
      `INSERT INTO pincode_wards (pincode, ward, lat, lng, post_offices) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (pincode) DO UPDATE SET ward=$2, lat=$3, lng=$4, post_offices=$5`,
      [r.pincode, r.ward, r.lat, r.lng, r.post_offices.join(", ")]
    );
  }
  const { rows: [{ n }] } = await c.query("SELECT count(*)::int AS n FROM pincode_wards");
  await c.end();
  console.log(`\ndone: ${out.length} pincodes mapped (table now has ${n}); skipped ${skippedPO} non-Vizag, ${skippedGeo} un-geocodable, ${skippedFar} too far from any ward.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
