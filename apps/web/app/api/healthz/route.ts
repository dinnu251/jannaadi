// GET /api/healthz — canonical health endpoint. The bare /healthz path is reserved by
// the external HTTPS load balancer's backend health check and never reaches the
// container, so uptime checks and the deploy smoke test must hit /api/healthz, which
// routes to the app reliably like every other /api/* route. Same logic as /healthz.
import { healthCheck } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  return healthCheck();
}
