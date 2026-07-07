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
import { uploadMedia, publishSubmission } from "@/lib/gcp";

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
});

const AUDIO_EXT: Record<string, string> = { "audio/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3" };
const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) return jsonError(400, "bad_request", "expected multipart/form-data");

    const parsed = FieldsZ.safeParse({
      channel: form.get("channel") ?? undefined,
      lang_hint: form.get("lang_hint") ?? undefined,
      text: typeof form.get("text") === "string" ? form.get("text") : undefined,
      caption: typeof form.get("caption") === "string" ? form.get("caption") : undefined,
      ward: typeof form.get("ward") === "string" ? (form.get("ward") as string) : undefined,
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

    const id = randomUUID();

    // media → GCS before the row commits, so a processed row never points at nothing
    let mediaUri: string | null = null;
    if (media) {
      mediaUri = await uploadMedia(
        `media/${id}.${media.ext}`,
        Buffer.from(await media.file.arrayBuffer()),
        media.file.type || "application/octet-stream"
      );
    }

    const lang = f.lang_hint === "auto" ? null : f.lang_hint;
    const rawText = f.channel === "photo" ? (f.caption ?? null) : (f.text ?? null);
    // Ingest stays open (citizens submit before/without signing in), but when a
    // session exists the row is stamped with the Google user id so the RLS citizen
    // policy lets them poll /api/submissions/:id for their own submission.
    const user = await sessionUser();
    if (user) {
      await db().query(
        `INSERT INTO submissions (id, status, channel, lang, raw_text, media_uri, ward, user_id)
         VALUES ($1, 'received', $2, $3, $4, $5, $6, $7)`,
        [id, f.channel, lang, rawText, mediaUri, f.ward ?? null, user.id]
      );
    } else {
      await db().query(
        `INSERT INTO submissions (id, status, channel, lang, raw_text, media_uri, ward)
         VALUES ($1, 'received', $2, $3, $4, $5, $6)`,
        [id, f.channel, lang, rawText, mediaUri, f.ward ?? null]
      );
    }
    await db().query(
      "INSERT INTO audit_events (submission_id, stage, detail) VALUES ($1, 'received', $2)",
      [id, JSON.stringify({ channel: f.channel, lang_hint: f.lang_hint, media_uri: mediaUri, ward_hint: f.ward ?? null })]
    );

    if (process.env.DEMO_MODE === "true") {
      // sync path (B1): same pipeline code as the worker, no Pub/Sub hop
      const { initWorker, processSubmission } = await import("../../../../../worker/ingest");
      await initWorker();
      const result = await processSubmission(id);
      if (result.status === "processed")
        return NextResponse.json({ submission_id: id, status: "processed", cluster_id: result.cluster_id, category: result.category });
      // failure already dead-lettered + status=failed by the pipeline — report loudly
      return jsonError(422, "processing_failed", result.status === "failed" ? result.reason : "submission not in received state");
    }

    try {
      await publishSubmission(id);
    } catch (e) {
      // row is safely persisted (replay picks up status=received) — but never silent:
      await db().query(
        "INSERT INTO deadletters (submission_id, failed_stage, reason, raw_response) VALUES ($1, 'received', 'pubsub_publish_failed', $2)",
        [id, String(e).slice(0, 4000)]
      );
      return jsonError(502, "publish_failed", `submission ${id} persisted but Pub/Sub publish failed: ${e}`);
    }
    return NextResponse.json({ submission_id: id, status: "received" }, { status: 202 });
  } catch (e) {
    return handleRouteError(e, "POST /api/ingest");
  }
}
