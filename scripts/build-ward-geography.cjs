// scripts/build-ward-geography.cjs — ward geography from India Post + Geocoding.
//
// For every Vizag pincode: pull its post-office AREAS (India Post official data),
// geocode each area, assign each point to its nearest ward, then per ward derive:
//   - member areas + pincodes ("areas mentioned under wards")
//   - a refined centroid (mean of member points, blended with the existing centroid)
//   - an approximate BOUNDARY (convex hull of member points; small circle when <3 pts)
//
// Outputs (files only — does NOT overwrite the wards table; see the comparison report):
//   data/ward_geography.json      per-ward: pincodes, areas, refined_centroid, hull
//   data/ward_boundaries.geojson  FeatureCollection (hull polygons + centroids) — ready
//                                 for dashboard rendering / Maps Datasets API upload /
//                                 future point-in-polygon in the worker
//   data/pincode_areas.json       pincode → [areas], ward assignment per area
//
// HONESTY NOTE: post-office points are sparse (~3-6 per pincode), so hulls are rough
// approximations, NOT legal ward boundaries. Official GVMC shapefiles supersede this.
//
// Run: node scripts/build-ward-geography.cjs
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^GOOGLE_MAPS_SERVER_KEY="([^"]+)"/m) ?? env.match(/^GOOGLE_MAPS_API_KEY="([^"]+)"/m))[1];
const WARDS = JSON.parse(fs.readFileSync(path.join(ROOT, "data/wards_clean.json"), "utf8"));

const CANDIDATES = [];
for (let p = 530001; p <= 530053; p++) CANDIDATES.push(String(p));
for (const p of ["531163", "531173"]) CANDIDATES.push(p);

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

// Monotone-chain convex hull on [lng, lat] points.
function hull(points) {
  const pts = [...new Map(points.map((p) => [p.join(","), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return null;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1));
  return h.length >= 3 ? [...h, h[0]] : null; // closed ring
}
// Small circle polygon (fallback boundary when a ward has <3 points).
function circle(lat, lng, radiusKm = 0.7, n = 16) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    ring.push([lng + (radiusKm / (111.32 * Math.cos(lat * rad))) * Math.cos(t), lat + (radiusKm / 110.57) * Math.sin(t)]);
  }
  return ring;
}

async function postOffices(pin) {
  try {
    const j = await (await fetch(`https://api.postalpincode.in/pincode/${pin}`)).json();
    const rec = Array.isArray(j) ? j[0] : null;
    if (rec?.Status !== "Success" || !rec.PostOffice) return [];
    return rec.PostOffice.filter((po) => /visakhapatnam/i.test(po.District ?? "")).map((po) => po.Name);
  } catch { return []; }
}

async function geocodeArea(name) {
  const q = `${name}, Visakhapatnam, Andhra Pradesh, India`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=in&key=${KEY}`;
  const j = await (await fetch(url)).json();
  if (j.status === "REQUEST_DENIED" || j.status === "OVER_QUERY_LIMIT") throw new Error(`Geocoding ${j.status}: ${j.error_message ?? ""}`);
  const res = j.results?.[0];
  if (j.status !== "OK" || !res) return null;
  const types = res.types || [];
  // Same guards as geocode-wards.cjs: no city-level fallbacks, no plus-codes, Vizag bbox only.
  const COARSE = ["locality", "administrative_area_level_1", "administrative_area_level_2", "administrative_area_level_3", "country", "postal_code"];
  if (COARSE.some((t) => types.includes(t)) || types.includes("plus_code")) return null;
  const { lat, lng } = res.geometry.location;
  if (!inVizag(lat, lng)) return null;
  if (/anakapalli|vizianagaram|nagarapalem|vijayarampuram/i.test((res.formatted_address || "").toLowerCase())) return null;
  return { lat, lng, matched: res.formatted_address };
}

(async () => {
  // 1. pincode → areas (India Post)
  const pincodeAreas = {};
  const uniqueAreas = new Map(); // name → { pincodes: Set }
  for (const pin of CANDIDATES) {
    const areas = await postOffices(pin);
    if (!areas.length) continue;
    pincodeAreas[pin] = areas;
    for (const a of areas) {
      if (!uniqueAreas.has(a)) uniqueAreas.set(a, new Set());
      uniqueAreas.get(a).add(pin);
    }
    await sleep(50);
  }
  console.log(`India Post: ${Object.keys(pincodeAreas).length} Vizag pincodes, ${uniqueAreas.size} unique areas`);

  // 2. geocode each area (with guards) and assign to nearest ward
  const areaPoints = [];
  let geoFail = 0, tooFar = 0;
  for (const [name, pins] of uniqueAreas) {
    let g = null;
    try { g = await geocodeArea(name); } catch (e) { console.error(`FATAL: ${e.message}`); process.exit(1); }
    await sleep(60);
    if (!g) { geoFail++; continue; }
    const { ward, km: dist } = nearestWard(g.lat, g.lng);
    if (dist > 5) { tooFar++; continue; } // not attributable to any GVMC ward
    areaPoints.push({ area: name, pincodes: [...pins], lat: g.lat, lng: g.lng, ward, km_to_ward: +dist.toFixed(2) });
    console.log(`  ✓ ${name} (${[...pins].join("/")}) → ${ward} (${dist.toFixed(1)}km)`);
  }
  console.log(`geocoded ${areaPoints.length} areas (${geoFail} unresolvable, ${tooFar} outside GVMC reach)`);

  // 3. per-ward aggregation: areas + pincodes + refined centroid + hull boundary
  const pincodeWards = fs.existsSync(path.join(ROOT, "data/pincode_wards.json"))
    ? JSON.parse(fs.readFileSync(path.join(ROOT, "data/pincode_wards.json"), "utf8")) : [];
  const byWard = {};
  for (const w of WARDS) byWard[w.name] = { ward: w.name, ward_number: w.ward_number, existing_centroid: { lat: w.lat, lng: w.lng }, areas: [], pincodes: new Set(), points: [[w.lng, w.lat]] };
  for (const p of areaPoints) {
    byWard[p.ward].areas.push({ name: p.area, lat: p.lat, lng: p.lng, pincodes: p.pincodes });
    p.pincodes.forEach((x) => byWard[p.ward].pincodes.add(x));
    byWard[p.ward].points.push([p.lng, p.lat]);
  }
  for (const r of pincodeWards) {
    if (byWard[r.ward]) { byWard[r.ward].pincodes.add(r.pincode); byWard[r.ward].points.push([r.lng, r.lat]); }
  }
  // Infrastructure anchors (railway stations, substations, BSNL exchanges, discom
  // offices — scripts/build-infra-anchors.cjs) densify the point set when present.
  const anchorsPath = path.join(ROOT, "data/infra_anchors.json");
  const infraAnchors = fs.existsSync(anchorsPath) ? JSON.parse(fs.readFileSync(anchorsPath, "utf8")) : [];
  for (const a of infraAnchors) {
    if (byWard[a.ward]) {
      byWard[a.ward].points.push([a.lng, a.lat]);
      (byWard[a.ward].anchors ??= []).push({ name: a.name, category: a.category, lat: a.lat, lng: a.lng });
    }
  }
  if (infraAnchors.length) console.log(`merged ${infraAnchors.length} infrastructure anchors into ward point sets`);

  const geography = [];
  const features = [];
  let withHull = 0, moved2km = 0;
  for (const w of Object.values(byWard)) {
    const lats = w.points.map((p) => p[1]), lngs = w.points.map((p) => p[0]);
    const refined = { lat: lats.reduce((a, b) => a + b) / lats.length, lng: lngs.reduce((a, b) => a + b) / lngs.length };
    const movedKm = km(w.existing_centroid.lat, w.existing_centroid.lng, refined.lat, refined.lng);
    if (movedKm > 2) moved2km++;
    const ring = hull(w.points) ?? circle(w.existing_centroid.lat, w.existing_centroid.lng);
    if (w.points.length >= 3) withHull++;
    geography.push({
      ward: w.ward, ward_number: w.ward_number,
      pincodes: [...w.pincodes].sort(),
      areas: w.areas,
      infra_anchors: w.anchors ?? [],
      existing_centroid: w.existing_centroid,
      refined_centroid: { lat: +refined.lat.toFixed(6), lng: +refined.lng.toFixed(6) },
      centroid_shift_km: +movedKm.toFixed(2),
      boundary_points: w.points.length,
      boundary_kind: w.points.length >= 3 ? "convex_hull" : "radius_circle",
    });
    features.push({
      type: "Feature",
      properties: { ward: w.ward, ward_number: w.ward_number, pincodes: [...w.pincodes].sort().join(","), kind: w.points.length >= 3 ? "convex_hull" : "radius_circle" },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
    features.push({
      type: "Feature",
      properties: { ward: w.ward, ward_number: w.ward_number, kind: "centroid" },
      geometry: { type: "Point", coordinates: [refined.lng, refined.lat] },
    });
  }

  fs.writeFileSync(path.join(ROOT, "data/pincode_areas.json"), JSON.stringify({ pincode_areas: pincodeAreas, area_points: areaPoints }, null, 2));
  fs.writeFileSync(path.join(ROOT, "data/ward_geography.json"), JSON.stringify(geography, null, 2));
  fs.writeFileSync(path.join(ROOT, "data/ward_boundaries.geojson"), JSON.stringify({ type: "FeatureCollection", features }, null, 2));

  console.log(`\ndone:`);
  console.log(`  data/pincode_areas.json     ${Object.keys(pincodeAreas).length} pincodes → ${areaPoints.length} placed areas`);
  console.log(`  data/ward_geography.json    98 wards (${withHull} with convex hulls, rest radius circles)`);
  console.log(`  data/ward_boundaries.geojson  ${features.length} features (polygons + centroids)`);
  console.log(`  centroid comparison: ${moved2km} wards where refined centroid differs >2km from current (review before adopting — NOT auto-applied)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
