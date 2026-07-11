// POST /api/verify/send — v1.2. Public. Sends an OTP via Twilio Verify to a phone
// number the citizen is about to attach to a submission. Rate-limited per phone
// (Twilio Verify itself also throttles, but a cheap local gate saves the API call).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, handleRouteError } from "@/lib/api";
import { sendOtp } from "@/lib/twilio";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodyZ = z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164, e.g. +919876543210") });

export async function POST(req: NextRequest) {
  try {
    const parsed = BodyZ.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "validation_failed", parsed.error.issues.map((i) => i.message).join("; "));
    const { phone } = parsed.data;

    const rl = rateLimit(`verify-send:${phone}`, 5, 15 * 60_000);
    if (!rl.ok) return jsonError(429, "rate_limited", `too many OTP requests for this number — retry in ${rl.retryAfterSec}s`);

    await sendOtp(phone);
    return NextResponse.json({ sent: true });
  } catch (e) {
    return handleRouteError(e, "POST /api/verify/send");
  }
}
