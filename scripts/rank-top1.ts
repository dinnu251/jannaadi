// scripts/rank-top1.ts — print the /api/rank top-1 cluster_id (authenticated).
// Used by demo-reset.sh (assert step 5) and snapshot.sh. Exits 1 loudly on
// empty rank, auth failure, or unreachable server.
// Usage: BASE_URL=... AUTH_SECRET=... npx tsx scripts/rank-top1.ts
import { mintSessionCookie } from "./lib/session";

async function main() {
  const base = process.env.BASE_URL;
  if (!base) throw new Error("BASE_URL required");
  const cookie = await mintSessionCookie({ role: "admin", sub: "demo-reset" });
  const res = await fetch(`${base}/api/rank`, { headers: { cookie } });
  if (res.status !== 200) throw new Error(`/api/rank → ${res.status}: ${await res.text()}`);
  const body: any = await res.json();
  if (!body.items?.length) throw new Error("/api/rank returned no items");
  console.log(body.items[0].cluster_id);
}

main().catch((e) => { console.error(`rank-top1 failed: ${e}`); process.exit(1); });
