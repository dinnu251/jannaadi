// Best-effort in-process sliding-window rate limiter for the public, cost-incurring
// endpoints (anonymous ingest hits Gemini/STT/GCS; Twilio webhooks the same). This is
// a DEFENSE-IN-DEPTH layer, not the primary control: it is per-instance and resets on
// cold start, so production should ALSO rate-limit at the edge (Cloud Armor / API
// Gateway / a shared Redis/Firestore counter). Disable with RATE_LIMIT_DISABLED=true.
const g = globalThis as unknown as { __rl?: Map<string, number[]> };
function store(): Map<string, number[]> {
  return (g.__rl ??= new Map<string, number[]>());
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  if (process.env.RATE_LIMIT_DISABLED === "true") return { ok: true, retryAfterSec: 0 };
  const now = Date.now();
  const s = store();
  const hits = (s.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    s.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  s.set(key, hits);
  // opportunistic cleanup so the map can't grow unbounded on a long-lived instance
  if (s.size > 5000) for (const [k, v] of s) if (v.every((t) => now - t >= windowMs)) s.delete(k);
  return { ok: true, retryAfterSec: 0 };
}

// Best-effort client IP from proxy headers (Cloud Run sets these).
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : "") || req.headers.get("x-real-ip") || "unknown";
}
