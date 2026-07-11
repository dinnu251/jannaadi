import { mintSessionCookie } from "./lib/session";

async function main() {
  const base = process.env.BASE_URL!;
  const cookie = await mintSessionCookie({ role: "admin", sub: "final-verify" });
  const r = await fetch(`${base}/api/rank`, { headers: { cookie } });
  const j: any = await r.json();
  console.log("HTTP", r.status, "| items:", j.items?.length, "| error:", JSON.stringify(j.error));
  if (j.items?.length) console.log("top1:", j.items[0].ward, "subs:", j.items[0].submission_count, "score:", j.items[0].score);
}
main().catch((e) => { console.error(e); process.exit(1); });
