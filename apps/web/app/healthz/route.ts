// GET /healthz — legacy/direct health path (API.md, B12). Works locally and on the
// direct Cloud Run URL, but is SHADOWED by the external HTTPS load balancer, which
// reserves /healthz for its own backend health check — so through the LB use the
// canonical /api/healthz instead. Both share lib/health.ts.
import { healthCheck } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  return healthCheck();
}
