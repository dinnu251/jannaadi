// scripts/show-rank-plan.ts — print /api/rank items with their plan_match (F14 QA).
// Usage: BASE_URL=... AUTH_SECRET=... npx tsx scripts/show-rank-plan.ts
import { mintSessionCookie } from "./lib/session";

async function main() {
  const base = process.env.BASE_URL ?? "http://localhost:3100";
  const cookie = await mintSessionCookie({ role: "admin", sub: "plan-qa" });
  const res = await fetch(`${base}/api/rank`, { headers: { cookie } });
  if (res.status !== 200) throw new Error(`/api/rank → ${res.status}: ${await res.text()}`);
  const body: any = await res.json();
  for (const it of body.items)
    console.log(`#${it.rank} ${it.ward} [${it.category}] score=${it.score} plan_match=${it.plan_match ? `"${it.plan_match.doc_title}" (rel ${it.plan_match.relevance})` : "null"}`);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
