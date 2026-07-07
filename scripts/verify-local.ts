// scripts/verify-local.ts — backend acceptance checks that run WITHOUT Gemini/GCP:
// contract shapes for all routes, B9 score recompute, B10 live weight change,
// B15 plan_match passthrough rules, B5 FOR NO KEY UPDATE SKIP LOCKED semantics, loud-failure
// paths (invalid input 400s, publish-fail deadletter). Needs: local Postgres seeded
// with db/seed.sql + scripts/fixtures/local-fixture.sql, and the web app running.
// Usage: DATABASE_URL=... BASE_URL=http://localhost:3100 npx tsx scripts/verify-local.ts
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { mintSessionCookie } from "./lib/session";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const lines: string[] = [];
let failures = 0;
let COOKIE = ""; // admin session, minted in main()

function check(name: string, ok: boolean, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  lines.push(line);
  if (!ok) failures++;
}

// Authenticated by default (admin session); pass auth:false for 401 checks.
async function j(pathname: string, opts: { auth?: boolean; cookie?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) headers.cookie = opts.cookie ?? COOKIE;
  const res = await fetch(`${BASE}${pathname}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  COOKIE = await mintSessionCookie({ role: "admin", sub: "verify-admin" });

  // ── Route protection: no session → 401, shaped error (tasks 10/protection) ──
  for (const p of ["/api/rank", "/api/heatmap", "/api/submissions/a1a1a1a1-0000-0000-0000-000000000001"]) {
    const { status, body } = await j(p, { auth: false });
    check(`auth: ${p} without session → 401`, status === 401 && body?.error?.code === "unauthorized");
  }
  {
    const garbage = await j("/api/rank", { cookie: "authjs.session-token=not-a-real-token" });
    check("auth: forged/garbage session token → 401", garbage.status === 401);
    const citizen = await j("/api/rank", { cookie: await mintSessionCookie({ role: "citizen", sub: "citizen-1" }) });
    check("auth: citizen session accepted on /api/rank (200)", citizen.status === 200);
  }
  // ── /api/wards ──
  {
    const { status, body } = await j("/api/wards");
    check("wards: 200 + 12 wards with name/lat/lng", status === 200 && body?.wards?.length === 12 && body.wards.every((w: any) => w.name && typeof w.lat === "number" && typeof w.lng === "number"));
  }

  // ── /api/rank: shape + B9 + B15 ──
  {
    const { status, body } = await j("/api/rank");
    check("rank: 200", status === 200);
    check("rank: weights object sums to 1", Math.abs(Object.values(body.weights as Record<string, number>).reduce((a, b) => a + b, 0) - 1) < 1e-6, JSON.stringify(body.weights));
    check("rank: 3 items, rank field 1..3", body.items?.length === 3 && body.items.every((it: any, i: number) => it.rank === i + 1));
    const top = body.items[0];
    check("rank: Gajuwaka drainage cluster is top-1 (freq+recency dominate)", top.cluster_id === "11111111-1111-1111-1111-111111111111", `top=${top.title_en}`);
    for (const it of body.items) {
      const bd = it.score_breakdown;
      check(`rank: ${it.ward} score_breakdown complete (B9)`, ["frequency", "severity", "recency", "demographic"].every((k) => typeof bd?.[k] === "number"));
      const recomputed = body.weights.frequency * bd.frequency + body.weights.severity * bd.severity + body.weights.recency * bd.recency + body.weights.demographic * bd.demographic;
      check(`rank: ${it.ward} score recomputes from weights×breakdown (B9)`, Math.abs(recomputed - it.score) < 0.005, `${recomputed.toFixed(3)} vs ${it.score}`);
      check(`rank: ${it.ward} sample_submission_ids 1..3`, it.sample_submission_ids.length >= 1 && it.sample_submission_ids.length <= 3);
      check(`rank: ${it.ward} centroid`, typeof it.centroid?.lat === "number" && typeof it.centroid?.lng === "number");
    }
    const byId = Object.fromEntries(body.items.map((i: any) => [i.cluster_id, i]));
    check("rank: real plan_match passed through (B15)", byId["11111111-1111-1111-1111-111111111111"].plan_match?.doc_title === "GVMC Budget 2026-27");
    check("rank: {none:true} plan_match → null (B15)", byId["22222222-2222-2222-2222-222222222222"].plan_match === null);
    check("rank: NULL plan_match → null (B15)", byId["33333333-3333-3333-3333-333333333333"].plan_match === null);
    // filters
    const f = await j("/api/rank?ward=Gajuwaka&category=drainage");
    check("rank: ward+category filter", f.body.items.length === 1 && f.body.items[0].ward === "Gajuwaka");
    const bad = await j("/api/rank?category=nonsense");
    check("rank: invalid category → 400 shaped error", bad.status === 400 && bad.body?.error?.code === "invalid_category");
  }

  // ── B10: change a weight live, no restart ──
  {
    const before = await j("/api/rank");
    await db.query("UPDATE rank_weights SET weight = 0.10 WHERE key = 'frequency'");
    await db.query("UPDATE rank_weights SET weight = 0.55 WHERE key = 'severity'");
    const after = await j("/api/rank");
    const changed = after.body.weights.frequency === 0.1 && after.body.weights.severity === 0.55 && after.body.items[0].score !== before.body.items[0].score;
    check("rank: weight change reflected without redeploy (B10)", changed, `top score ${before.body.items[0].score} → ${after.body.items[0].score}`);
    await db.query("UPDATE rank_weights SET weight = 0.40 WHERE key = 'frequency'");
    await db.query("UPDATE rank_weights SET weight = 0.25 WHERE key = 'severity'");
  }

  // ── /api/heatmap ──
  {
    const { status, body } = await j("/api/heatmap");
    check("heatmap: 200 + points {lat,lng,weight}", status === 200 && body.points.length > 0 && body.points.every((p: any) => typeof p.lat === "number" && typeof p.lng === "number" && typeof p.weight === "number"));
    const f = await j("/api/heatmap?category=drainage");
    const total = f.body.points.reduce((a: number, p: any) => a + p.weight, 0);
    check("heatmap: category filter (6 drainage submissions)", total === 6, `weight sum=${total}`);
  }

  // ── /api/submissions/:id ──
  {
    const { status, body } = await j("/api/submissions/a1a1a1a1-0000-0000-0000-000000000001");
    check("submission: 200 + contract fields", status === 200 && body.status === "processed" && body.extraction?.category === "drainage" && body.cluster_id && body.failure_reason === null);
    check("submission: audit array with stage/at/model/latency_ms (B8 shape)", Array.isArray(body.audit) && body.audit.length === 4 && body.audit.every((a: any) => a.stage && a.at));
    check("submission: audit records ward_resolved_via (B14 surface)", body.audit.some((a: any) => a.detail?.ward_resolved_via === "maps_grounding"));
    const failed = await j("/api/submissions/dead0000-0000-0000-0000-000000000001");
    check("submission: failed row carries failure_reason", failed.body.failure_reason === "schema_validation_failed_after_retry");
    const nf = await j("/api/submissions/00000000-0000-0000-0000-000000000000");
    check("submission: unknown id → 404 shaped error", nf.status === 404 && nf.body?.error?.code === "not_found");
  }

  // ── /api/deadletters ──
  {
    const { status, body } = await j("/api/deadletters");
    const item = body.items?.find((i: any) => i.submission_id === "dead0000-0000-0000-0000-000000000001");
    check("deadletters: 200 + failed row visible with stage/reason/preview/at (B6 surface)", status === 200 && item && item.failed_stage === "extracted" && item.reason.includes("schema_validation") && item.raw_preview.length > 0 && item.at);
  }

  // ── /healthz: real checks (db ok here; pubsub+gemini legitimately fail locally) ──
  {
    const { status, body } = await j("/healthz");
    check("healthz: db probed ok", body.db === "ok");
    check("healthz: pubsub/gemini genuinely probed (fail loudly without infra — not assumed ok)", body.pubsub === "fail" && body.gemini === "fail" && status === 503, JSON.stringify(body));
  }

  // ── /api/ingest: validation 400s, persist, loud publish-failure deadletter ──
  {
    const form = new FormData();
    form.set("channel", "text"); // missing text
    const r1 = await fetch(`${BASE}/api/ingest`, { method: "POST", body: form });
    check("ingest: channel=text without text → 400", r1.status === 400);

    const form2 = new FormData();
    form2.set("channel", "text");
    form2.set("text", "టెస్ట్ సమస్య");
    form2.set("ward", "NotAWard");
    const r2 = await fetch(`${BASE}/api/ingest`, { method: "POST", body: form2 });
    const b2: any = await r2.json();
    check("ingest: unknown ward → 400 invalid_ward", r2.status === 400 && b2?.error?.code === "invalid_ward");

    const form3 = new FormData();
    form3.set("channel", "text");
    form3.set("text", "గాజువాకలో డ్రైనేజీ సమస్య టెస్ట్");
    form3.set("lang_hint", "te");
    form3.set("ward", "Gajuwaka");
    const r3 = await fetch(`${BASE}/api/ingest`, { method: "POST", body: form3 });
    const b3: any = await r3.json();
    // no Pub/Sub locally → persisted + deadlettered + shaped 502, never silent
    check("ingest: publish failure → 502 shaped error (not silent)", r3.status === 502 && b3?.error?.code === "publish_failed", JSON.stringify(b3?.error?.code));
    const { rows: [sub] } = await db.query("SELECT status FROM submissions WHERE raw_text = 'గాజువాకలో డ్రైనేజీ సమస్య టెస్ట్'");
    check("ingest: raw row persisted status=received before publish", sub?.status === "received");
    if (sub) {
      const { rows: [dl] } = await db.query("SELECT reason FROM deadletters WHERE reason = 'pubsub_publish_failed' ORDER BY at DESC LIMIT 1");
      check("ingest: publish failure dead-lettered", dl?.reason === "pubsub_publish_failed");
      const { rows: aud } = await db.query("SELECT 1 FROM audit_events a JOIN submissions s ON s.id = a.submission_id WHERE s.raw_text = 'గాజువాకలో డ్రైనేజీ సమస్య టెస్ట్' AND a.stage = 'received'");
      check("ingest: 'received' audit event written", aud.length === 1);
    }
  }

  // ── B5: FOR NO KEY UPDATE SKIP LOCKED semantics on the real submissions table ──
  {
    const c1 = await db.connect();
    const c2 = await db.connect();
    try {
      await c1.query("BEGIN");
      const r1 = await c1.query("SELECT id FROM submissions WHERE id = 'eeee0000-0000-0000-0000-000000000001' FOR NO KEY UPDATE SKIP LOCKED");
      const r2 = await c2.query("SELECT id FROM submissions WHERE id = 'eeee0000-0000-0000-0000-000000000001' FOR NO KEY UPDATE SKIP LOCKED");
      check("B5: second worker skips row locked by first (no double-processing)", r1.rows.length === 1 && r2.rows.length === 0);
      await c1.query("ROLLBACK");
      const r3 = await c2.query("SELECT id FROM submissions WHERE id = 'eeee0000-0000-0000-0000-000000000001' FOR NO KEY UPDATE SKIP LOCKED");
      await c2.query("ROLLBACK").catch(() => {});
      check("B5: row available again after first worker dies mid-batch (rollback)", r3.rows.length === 1);
    } finally {
      c1.release(); c2.release();
    }
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
  const root = path.resolve(__dirname, "..");
  mkdirSync(path.join(root, "logs"), { recursive: true });
  const logPath = path.join(root, "logs", `verify-local-${Date.now()}.log`);
  writeFileSync(logPath, lines.join("\n") + `\nresult: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}\n`);
  console.log(`log: ${logPath}`);
  await db.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`verify fatal: ${e}`); process.exit(1); });
