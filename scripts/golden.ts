// scripts/golden.ts — golden test runner (B11, docs/GOLDEN.md).
// Drives all 15 inputs through POST /api/ingest against a DEMO_MODE server,
// reads GET /api/submissions/:id, asserts category/ward/severity/summary/retry.
// 15/15 → exit 0, anything else → exit 1. Log written to logs/golden-<ts>.log.
//
// Usage: BASE_URL=http://localhost:3000 npx tsx scripts/golden.ts [--only G01,G05]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { mintSessionCookie } from "./lib/session";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ROOT = path.resolve(__dirname, "..");
let COOKIE = ""; // minted in main() — /api/submissions/:id requires a session

type Item = {
  id: string; lang_hint: string; channel: "text" | "voice" | "photo";
  text?: string; caption?: string; ward?: string; audio?: string; image?: string;
  expected_category: string; expected_ward: string | string[];
  severity_min: number; severity_max: number;
  expect_ward_resolved_via?: string;
};

const lines: string[] = [];
function log(s: string) { console.log(s); lines.push(s); }

const MIME: Record<string, string> = { webm: "audio/webm", wav: "audio/wav", mp3: "audio/mpeg", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

async function runItem(it: Item): Promise<{ pass: boolean; detail: string }> {
  // assemble multipart
  const form = new FormData();
  form.set("channel", it.channel);
  form.set("lang_hint", it.lang_hint);
  if (it.text) form.set("text", it.text);
  if (it.caption) form.set("caption", it.caption);
  if (it.ward) form.set("ward", it.ward);
  for (const [field, rel] of [["audio", it.audio], ["image", it.image]] as const) {
    if (!rel) continue;
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) return { pass: false, detail: `MISSING ASSET ${rel} — record it (see assets/golden/README.md, task H-1)` };
    const ext = rel.split(".").pop()!.toLowerCase();
    form.set(field, new Blob([readFileSync(abs)], { type: MIME[ext] ?? "application/octet-stream" }), path.basename(rel));
  }

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/ingest`, { method: "POST", body: form, headers: { cookie: COOKIE } });
  const body: any = await res.json().catch(() => null);
  if (res.status !== 200 || body?.status !== "processed")
    return { pass: false, detail: `ingest → ${res.status} ${JSON.stringify(body)} (server must run with DEMO_MODE=true)` };

  const sres = await fetch(`${BASE}/api/submissions/${body.submission_id}`, { headers: { cookie: COOKIE } });
  const sub: any = await sres.json();
  if (sres.status !== 200) return { pass: false, detail: `submissions/:id → ${sres.status} ${JSON.stringify(sub)}` };

  const ex = sub.extraction;
  const errs: string[] = [];
  if (!ex) errs.push("extraction missing");
  else {
    if (ex.category !== it.expected_category) errs.push(`category ${ex.category} ≠ ${it.expected_category}`);
    const wardOk = Array.isArray(it.expected_ward) ? it.expected_ward.includes(ex.ward) : ex.ward === it.expected_ward;
    if (!wardOk) errs.push(`ward ${ex.ward} ∉ ${JSON.stringify(it.expected_ward)}`);
    if (ex.severity < it.severity_min || ex.severity > it.severity_max) errs.push(`severity ${ex.severity} ∉ [${it.severity_min},${it.severity_max}]`);
    if (!ex.summary_en?.trim()) errs.push("summary_en empty");
  }
  // pass rule: valid JSON first attempt or single retry
  const retries = (sub.audit as any[]).filter((a) => a.stage === "extracted" && a.detail?.retry != null).map((a) => a.detail.retry);
  if (retries.length && Math.max(...retries) > 1) errs.push(`retries ${Math.max(...retries)} > 1`);
  // B14 hook: landmark-only items must resolve via maps grounding
  if (it.expect_ward_resolved_via) {
    const via = (sub.audit as any[]).find((a) => a.detail?.ward_resolved_via)?.detail?.ward_resolved_via;
    if (via !== it.expect_ward_resolved_via) errs.push(`ward_resolved_via ${via} ≠ ${it.expect_ward_resolved_via}`);
  }

  const took = Date.now() - t0;
  return errs.length
    ? { pass: false, detail: `${errs.join("; ")} (${took}ms, sub=${body.submission_id})` }
    : { pass: true, detail: `category=${ex.category} ward=${ex.ward} sev=${ex.severity} (${took}ms)` };
}

async function main() {
  COOKIE = await mintSessionCookie({ role: "admin", sub: "golden-runner" });
  const set = JSON.parse(readFileSync(path.join(ROOT, "scripts", "golden-set.json"), "utf8"));
  const onlyArg = process.argv.find((a) => a.startsWith("--only"));
  const only = onlyArg ? (onlyArg.split("=")[1] ?? process.argv[process.argv.indexOf(onlyArg) + 1]).split(",") : null;
  const items: Item[] = set.items.filter((i: Item) => !only || only.includes(i.id));

  log(`golden run @ ${new Date().toISOString()} against ${BASE} — ${items.length} items`);
  let passed = 0;
  for (const it of items) {
    try {
      const r = await runItem(it);
      log(`${r.pass ? "PASS" : "FAIL"} ${it.id}: ${r.detail}`);
      if (r.pass) passed++;
    } catch (e) {
      log(`FAIL ${it.id}: runner error: ${e}`);
    }
  }
  log(`result: ${passed}/${items.length}`);

  mkdirSync(path.join(ROOT, "logs"), { recursive: true });
  const logPath = path.join(ROOT, "logs", `golden-${Date.now()}.log`);
  writeFileSync(logPath, lines.join("\n") + "\n");
  console.log(`log: ${logPath}`);
  process.exit(passed === items.length ? 0 : 1);
}

main().catch((e) => { console.error(`golden runner fatal: ${e}`); process.exit(1); });
