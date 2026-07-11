// POST /api/ingest — citizen submission (API.md).
// Persist raw row status=received → upload media to GCS → publish {submission_id}
// to Pub/Sub 'submissions' → 202. DEMO_MODE=true: process synchronously → 200.
// Every path writes an audit event; every failure is a shaped error, never silent.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sessionUser } from "@/auth";
import { db } from "@/lib/db";
import { jsonError, handleRouteError } from "@/lib/api";
import { uploadMedia } from "@/lib/gcp";
import { persistAndProcess } from "@/lib/intake";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { checkVerifyToken } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // DEMO_MODE sync processing budget (<30s target, B1)

const MAX_TEXT = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // contract: 5MB
const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 60s webm/wav/mp3 comfortably under this

const FieldsZ = z.object({
  channel: z.enum(["text", "voice", "photo"]),
  lang_hint: z.enum(["te", "hi", "en", "auto"]).default("auto"),
  text: z.string().max(MAX_TEXT).optional(),
  caption: z.string().max(MAX_TEXT).optional(),
  ward: z.string().optional(),
  // v1.2: optional, explicit citizen opt-in for feedback-loop SMS/WhatsApp updates.
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  verify_token: z.string().optional(),
});

const AUDIO_EXT: Record<string, string> = { "audio/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3" };
const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

export async function POST(req: NextRequest) {
  try {
    // Cheap first line of defence for an open, cost-incurring endpoint (Gemini/STT/GCS).
    const rl = rateLimit(`ingest:${clientIp(req)}`, 30, 60_000);
    if (!rl.ok) return jsonError(429, "rate_limited", `too many submissions — retry in ${rl.retryAfterSec}s`);

    const form = await req.formData().catch(() => null);
    if (!form) return jsonError(400, "bad_request", "expected multipart/form-data");

    const parsed = FieldsZ.safeParse({
      channel: form.get("channel") ?? undefined,
      lang_hint: form.get("lang_hint") ?? undefined,
      text: typeof form.get("text") === "string" ? form.get("text") : undefined,
      caption: typeof form.get("caption") === "string" ? form.get("caption") : undefined,
      ward: typeof form.get("ward") === "string" ? (form.get("ward") as string) : undefined,
      phone: typeof form.get("phone") === "string" ? (form.get("phone") as string) : undefined,
      verify_token: typeof form.get("verify_token") === "string" ? (form.get("verify_token") as string) : undefined,
    });
    if (!parsed.success)
      return jsonError(400, "validation_failed", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const f = parsed.data;

    // channel-specific requirements
    const audio = form.get("audio");
    const image = form.get("image");
    if (f.channel === "text" && !f.text?.trim()) return jsonError(400, "validation_failed", "text required for channel=text");
    if (f.channel === "voice" && !(audio instanceof File)) return jsonError(400, "validation_failed", "audio file required for channel=voice");
    if (f.channel === "photo" && !(image instanceof File)) return jsonError(400, "validation_failed", "image file required for channel=photo");

    let media: { file: File; ext: string } | null = null;
    if (f.channel === "voice") {
      const a = audio as File;
      const ext = AUDIO_EXT[a.type] ?? (a.name.match(/\.(webm|wav|mp3)$/i)?.[1]?.toLowerCase() ?? null);
      if (!ext) return jsonError(400, "validation_failed", `unsupported audio type: ${a.type || a.name}`);
      if (a.size > MAX_AUDIO_BYTES) return jsonError(400, "validation_failed", "audio too large (max ~60s)");
      media = { file: a, ext };
    }
    if (f.channel === "photo") {
      const i = image as File;
      const ext = IMAGE_EXT[i.type] ?? (i.name.match(/\.(jpe?g|png)$/i) ? (i.name.toLowerCase().endsWith("png") ? "png" : "jpg") : null);
      if (!ext) return jsonError(400, "validation_failed", `unsupported image type: ${i.type || i.name} (jpg/png only)`);
      if (i.size > MAX_IMAGE_BYTES) return jsonError(400, "validation_failed", "image too large (max 5MB)");
      media = { file: i, ext };
    }

    // ward hint must come from the /api/wards enum (closed list)
    if (f.ward) {
      const { rows } = await db().query("SELECT 1 FROM wards WHERE name = $1", [f.ward]);
      if (!rows.length) return jsonError(400, "invalid_ward", `unknown ward: ${f.ward}`);
    }

    // media → GCS before the row is created, so a processed row never points at nothing
    let mediaUri: string | null = null;
    if (media) {
      mediaUri = await uploadMedia(
        `media/${randomUUID()}.${media.ext}`,
        Buffer.from(await media.file.arrayBuffer()),
        media.file.type || "application/octet-stream"
      );
    }

    // v1.2: phone is stored only when verify_token proves it passed OTP for THIS
    // number (checkVerifyToken binds phone+token together) — never store an unverified
    // number as if it were confirmed, but never block the submission either.
    const phoneVerified = !!(f.phone && checkVerifyToken(f.phone, f.verify_token));

    const user = await sessionUser();
    const result = await persistAndProcess({
      channel: f.channel,
      lang: f.lang_hint === "auto" ? null : f.lang_hint,
      rawText: f.channel === "photo" ? (f.caption ?? null) : (f.text ?? null),
      mediaUri,
      ward: f.ward ?? null,
      userId: user?.id ?? null,
      source: "web",
      phone: f.phone ?? null,
      phoneVerified,
    });

    if (result.status === "processed")
      return NextResponse.json({ submission_id: result.submission_id, status: "processed", cluster_id: result.cluster_id, category: result.category, ward: result.ward, duplicate_of: result.duplicate_of });
    if (result.status === "failed")
      return jsonError(result.code === "publish_failed" ? 502 : 422, result.code, result.message);
    return NextResponse.json({ submission_id: result.submission_id, status: "received" }, { status: 202 });
  } catch (e) {
    return handleRouteError(e, "POST /api/ingest");
  }
}
