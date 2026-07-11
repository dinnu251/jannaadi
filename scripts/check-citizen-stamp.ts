// One-shot check: authenticated citizen ingest → row stamped with their user_id,
// and they can poll their own submission through the protected route.
import { Pool } from "pg";
import { mintSessionCookie } from "./lib/session";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";

async function main() {
  const cookie = await mintSessionCookie({ role: "citizen", sub: "citizen-e2e-77" });
  const fd = new FormData();
  fd.set("channel", "text");
  fd.set("text", "citizen user_id stamp test");
  fd.set("ward", "Ward 75 - Pedagantyada");
  const r = await fetch(`${BASE}/api/ingest`, { method: "POST", body: fd, headers: { cookie } });
  const body: any = await r.json();
  // local env has no Pub/Sub → expect the loud 502 AFTER persist; the row must exist
  console.log(`ingest: ${r.status} ${body?.error?.code ?? body?.status}`);

  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows: [row] } = await db.query("SELECT id, user_id, status FROM submissions WHERE raw_text = 'citizen user_id stamp test'");
  console.log(`row: user_id=${row?.user_id} status=${row?.status}`);
  console.log(row?.user_id === "citizen-e2e-77" ? "PASS user_id stamped from session" : "FAIL user_id not stamped");

  const poll = await fetch(`${BASE}/api/submissions/${row.id}`, { headers: { cookie } });
  console.log(poll.status === 200 ? "PASS citizen can poll own submission (200)" : `FAIL poll → ${poll.status}`);
  const other = await fetch(`${BASE}/api/submissions/${row.id}`, { headers: { cookie: await mintSessionCookie({ role: "citizen", sub: "someone-else" }) } });
  // RLS_ENFORCED=true → server runs as jannaadi_web (non-owner): cross-tenant read MUST 404.
  // Owner connection (local default) bypasses RLS → 200 expected, noted not failed.
  if (process.env.RLS_ENFORCED === "true") {
    console.log(other.status === 404 ? "PASS cross-tenant poll blocked by RLS (404)" : `FAIL cross-tenant poll → ${other.status} (expected 404)`);
    if (other.status !== 404) process.exitCode = 1;
  } else {
    console.log(`other citizen polling it → ${other.status} (owner connection bypasses RLS; rerun with RLS_ENFORCED=true + WEB_DATABASE_URL server for the real check)`);
  }
  await db.end();
}

main().catch((e) => { console.error(`check failed: ${e}`); process.exit(1); });
