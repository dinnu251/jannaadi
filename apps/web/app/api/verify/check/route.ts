// POST /api/verify/check — v1.2. Public. Verifies the OTP and mints a short-lived,
// phone-scoped token the citizen passes to POST /api/ingest to mark phone_verified.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, handleRouteError } from "@/lib/api";
import { checkOtp, mintVerifyToken } from "@/lib/twilio";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodyZ = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164, e.g. +919876543210"),
  code: z.string().regex(/^\d{4,10}$/, "code must be numeric"),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = BodyZ.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "validation_failed", parsed.error.issues.map((i) => i.message).join("; "));
    const { phone, code } = parsed.data;

    // Bounds brute-force guessing of the OTP itself (Twilio Verify also locks after
    // repeated failures, but this keeps that behavior visible and testable locally).
    const rl = rateLimit(`verify-check:${phone}`, 8, 15 * 60_000);
    if (!rl.ok) return jsonError(429, "rate_limited", `too many attempts — retry in ${rl.retryAfterSec}s`);

    const ok = await checkOtp(phone, code);
    if (!ok) return jsonError(400, "invalid_code", "incorrect or expired code");

    return NextResponse.json({ verified: true, verify_token: mintVerifyToken(phone) });
  } catch (e) {
    return handleRouteError(e, "POST /api/verify/check");
  }
}
