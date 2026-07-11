// scripts/geocode-wards.cjs — improve ward centroid accuracy.
//
// The seeded ward coordinates are hand-entered approximations (approx_lat/lng), which
// makes the worker's nearest-centroid ward resolution snap complaints to the wrong ward.
// This re-derives each ward's coordinates from the Google Geocoding API (server-side),
// validates the result is inside the Visakhapatnam bounding box AND that Google actually
// matched the locality (not a city-center fallback), then UPDATEs the wards table.
// On any rejection the existing coordinate is kept. A full before/after report is written
// to data/wards_geocoded.json; wards_clean.json is updated in place (backup written first).
//
// Run:  node scripts/geocode-wards.cjs            (updates DB + files)
//       node scripts/geocode-wards.cjs --dry-run  (report only, no writes)
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const DRY = process.argv.includes("--dry-run");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
// Server key first (unrestricted-by-referrer; the browser key is referrer-locked and
// would reject server-side calls, which send no Referer header).
const KEY = (env.match(/^GOOGLE_MAPS_SERVER_KEY="([^"]+)"/m) ?? env.match(/^GOOGLE_MAPS_API_KEY="([^"]+)"/m))[1];
const DBURL = env.match(/^DATABASE_URL="([^"]+)"/m)[1];

// Vizag sanity box — mirrors worker/ingest.ts groundLandmark()
const inVizag = (lat, lng) => lat > 17.4 && lat < 18.2 && lng > 82.8 && lng < 83.7;
const haversineKm = (a, b, c, d) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (c - a) * r, dLng = (d - b) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(x));
};
const localityOf = (name) => name.replace(/^Ward\s+\d+\s*[-–]\s*/i, "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(locality) {
  const q = `${locality}, Visakhapatnam, Andhra Pradesh, India`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=in&key=${KEY}`;
  const j = await (await fetch(url)).json();
  if (j.status === "REQUEST_DENIED" || j.status === "OVER_QUERY_LIMIT")
    throw new Error(`Geocoding ${j.status}: ${j.error_message || ""}`); // fail loud — key/quota problem
  const res = j.results && j.results[0];
  if (j.status !== "OK" || !res) return { ok: false, reason: j.status };
  const { lat, lng } = res.geometry.location;
  const addr = (res.formatted_address || "").toLowerCase();
  const types = res.types || [];
  // Reject a city/admin-level fallback: those types mean Google couldn't place the
  // locality and returned the whole city/district centroid — no better than what we have.
  const COARSE = ["locality", "administrative_area_level_1", "administrative_area_level_2", "administrative_area_level_3", "country", "postal_code"];
  if (COARSE.some((t) => types.includes(t))) return { ok: false, reason: `coarse(${types.join(",")})`, lat, lng, addr: res.formatted_address };
  // Plus-code / bare-pluscode results are Google's "I only have a grid cell" answer — imprecise, often out-of-area.
  if (types.includes("plus_code") || /^[23456789cfghjmpqrvwx]{4}\+[23456789cfghjmpqrvwx]{2,3}\b/i.test(res.formatted_address))
    return { ok: false, reason: "plus_code", lat, lng, addr: res.formatted_address };
  // Jurisdiction guard: separate towns/pincodes outside GVMC that fuzzy-matched a ward
  // name. 531162 (Nagarapalem), 531219 (Vijayarampuram), 531001 (Anakapalli) etc. are
  // outside the GVMC 530xxx core — a same-name match there is almost certainly wrong.
  if (/anakapalli|vizianagaram|nagarapalem|vijayarampuram/i.test(addr) || /\b(531162|531219|531001|531002|535\d{3})\b/.test(res.formatted_address))
    return { ok: false, reason: "other_jurisdiction", lat, lng, addr: res.formatted_address };
  if (!inVizag(lat, lng)) return { ok: false, reason: "out_of_bbox", lat, lng, addr: res.formatted_address };
  return { ok: true, lat, lng, addr: res.formatted_address, types };
}

(async () => {
  const c = new Client({ connectionString: DBURL });
  await c.connect();
  const { rows: wards } = await c.query("SELECT name, lat, lng FROM wards ORDER BY ward_number");
  console.log(`geocoding ${wards.length} wards${DRY ? " (DRY RUN)" : ""}...\n`);

  const report = [];
  let updated = 0, kept = 0;
  for (const w of wards) {
    const loc = localityOf(w.name);
    let g;
    try { g = await geocode(loc); }
    catch (e) { console.error(`FATAL: ${e.message}`); await c.end(); process.exit(1); }
    await sleep(60); // gentle pacing

    if (g.ok) {
      const moved = haversineKm(w.lat, w.lng, g.lat, g.lng);
      report.push({ name: w.name, locality: loc, old: [w.lat, w.lng], new: [g.lat, g.lng], moved_km: +moved.toFixed(2), matched: g.addr, action: "updated" });
      if (!DRY) await c.query("UPDATE wards SET lat=$1, lng=$2 WHERE name=$3", [g.lat, g.lng, w.name]);
      updated++;
      if (moved > 2) console.log(`  ~ ${w.name}: moved ${moved.toFixed(1)}km  ->  ${g.addr}`);
    } else {
      report.push({ name: w.name, locality: loc, old: [w.lat, w.lng], new: null, reason: g.reason, action: "kept_old" });
      kept++;
      console.log(`  ! ${w.name}: kept old (${g.reason}${g.addr ? " -> " + g.addr : ""})`);
    }
  }

  // Persist report + updated canonical file (with backup)
  fs.writeFileSync(path.join(ROOT, "data/wards_geocoded.json"), JSON.stringify(report, null, 2));
  if (!DRY) {
    const cleanPath = path.join(ROOT, "data/wards_clean.json");
    if (fs.existsSync(cleanPath)) {
      fs.copyFileSync(cleanPath, cleanPath + ".bak");
      const clean = JSON.parse(fs.readFileSync(cleanPath, "utf8"));
      const byName = new Map(report.filter((r) => r.new).map((r) => [r.name, r.new]));
      for (const row of clean) if (byName.has(row.name)) { [row.lat, row.lng] = byName.get(row.name); }
      fs.writeFileSync(cleanPath, JSON.stringify(clean, null, 2));
    }
  }

  console.log(`\n${DRY ? "[dry-run] " : ""}done: ${updated} updated, ${kept} kept old (rejected). report -> data/wards_geocoded.json`);
  const big = report.filter((r) => r.moved_km > 2).length;
  console.log(`${big} wards moved >2km (were significantly off). ${kept} localities Google couldn't place inside Vizag.`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
