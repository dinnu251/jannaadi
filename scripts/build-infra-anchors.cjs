// scripts/build-infra-anchors.cjs — public-infrastructure anchor points for ward geography.
//
// BSNL/APEPDCL/POWERGRID don't publish open location APIs (their asset registers are
// PDFs/closed portals), but the same physical infrastructure exists as geocoded POIs in
// Google Places — railway stations, electrical substations, BSNL telephone exchanges,
// APEPDCL/discom offices. This sweeps Places Text Search for those categories across
// Visakhapatnam, applies the same jurisdiction/bbox guards as the other geo scripts,
// assigns each anchor to its nearest ward, and writes data/infra_anchors.json.
// build-ward-geography.cjs merges this file (when present) into each ward's point set,
// densifying hulls and refining centroids with real, verifiable landmarks.
//
// Run: node scripts/build-infra-anchors.cjs   (then re-run build-ward-geography.cjs)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^GOOGLE_MAPS_SERVER_KEY="([^"]+)"/m) ?? env.match(/^GOOGLE_MAPS_API_KEY="([^"]+)"/m))[1];
const WARDS = JSON.parse(fs.readFileSync(path.join(ROOT, "data/wards_clean.json"), "utf8"));

const QUERIES = [
  { category: "railway_station", q: "railway station in Visakhapatnam" },
  { category: "substation",      q: "electrical substation in Visakhapatnam" },
  { category: "substation",      q: "APEPDCL substation Visakhapatnam" },
  { category: "substation",      q: "33/11 KV substation Visakhapatnam" },
  { category: "power_grid",      q: "power grid substation Visakhapatnam" },
  { category: "bsnl",            q: "BSNL telephone exchange Visakhapatnam" },
  { category: "bsnl",            q: "BSNL office Visakhapatnam" },
  { category: "discom_office",   q: "APEPDCL office Visakhapatnam" },
];

const rad = Math.PI / 180;
const km = (a, b, c, d) => {
  const x = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
};
const nearestWard = (lat, lng) => {
  let best = null, bestKm = Infinity;
  for (const w of WARDS) { const d = km(lat, lng, w.lat, w.lng); if (d < bestKm) { bestKm = d; best = w; } }
  return { ward: best.name, km: bestKm };
};
const inVizag = (lat, lng) => lat > 17.4 && lat < 18.2 && lng > 82.8 && lng < 83.7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function textSearch(query) {
  const out = [];
  let pagetoken = null;
  for (let page = 0; page < 3; page++) {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&region=in&key=${KEY}` +
      (pagetoken ? `&pagetoken=${pagetoken}` : "");
    const j = await (await fetch(url)).json();
    if (j.status === "REQUEST_DENIED" || j.status === "OVER_QUERY_LIMIT") throw new Error(`Places ${j.status}: ${j.error_message ?? ""}`);
    if (j.status !== "OK" && j.status !== "ZERO_RESULTS") break;
    out.push(...(j.results ?? []));
    pagetoken = j.next_page_token;
    if (!pagetoken) break;
    await sleep(2100); // next_page_token needs ~2s to activate
  }
  return out;
}

(async () => {
  const seen = new Map(); // place_id → anchor
  let rejected = 0;
  for (const { category, q } of QUERIES) {
    let results = [];
    try { results = await textSearch(q); } catch (e) { console.error(`FATAL: ${e.message}`); process.exit(1); }
    let kept = 0;
    for (const r of results) {
      if (seen.has(r.place_id)) { // same place from two queries — keep first category
        continue;
      }
      const lat = r.geometry?.location?.lat, lng = r.geometry?.location?.lng;
      const addr = (r.formatted_address || "").toLowerCase();
      if (lat == null || !inVizag(lat, lng)) { rejected++; continue; }
      if (/anakapalli|vizianagaram|nagarapalem|vijayarampuram/.test(addr)) { rejected++; continue; }
      const { ward, km: dist } = nearestWard(lat, lng);
      if (dist > 5) { rejected++; continue; }
      seen.set(r.place_id, {
        name: r.name, category, lat, lng, ward, km_to_ward: +dist.toFixed(2),
        address: (r.formatted_address || "").slice(0, 90),
      });
      kept++;
    }
    console.log(`  ${q} → ${results.length} results, ${kept} kept`);
    await sleep(150);
  }

  const anchors = [...seen.values()];
  fs.writeFileSync(path.join(ROOT, "data/infra_anchors.json"), JSON.stringify(anchors, null, 2));
  const byCat = {};
  for (const a of anchors) byCat[a.category] = (byCat[a.category] ?? 0) + 1;
  const wardsCovered = new Set(anchors.map((a) => a.ward)).size;
  console.log(`\ndone: ${anchors.length} anchors (${JSON.stringify(byCat)}), touching ${wardsCovered} wards; ${rejected} rejected by guards.`);
  console.log(`next: node scripts/build-ward-geography.cjs   (merges anchors into hulls/centroids)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
