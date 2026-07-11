// Shared submission intake — the single place a citizen complaint becomes a row and
// enters the pipeline, regardless of how it arrived (web form, SMS, WhatsApp, phone
// call). Every entry point (apps/web/app/api/ingest, apps/web/app/api/twilio/*) funnels
// through persistAndProcess so there is exactly one persist → audit → dispatch path.
//
// Contract preserved from the original /api/ingest tail: raw row status=received →
// audit 'received' → DEMO_MODE processes synchronously, else publish to Pub/Sub 'submissions'.
// Nothing is silent: a failed publish is dead-lettered before the error surfaces.
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { publishSubmission } from "@/lib/gcp";

export type IntakeInput = {
  channel: "text" | "voice" | "photo";
  lang: "te" | "hi" | "en" | null; // null = auto-detect downstream
  rawText: string | null;          // text body, or photo caption
  mediaUri: string | null;         // gs:// URI, already uploaded by the caller
  ward: string | null;             // citizen-selected ward (validated by caller), else null
  userId?: string | null;          // Google account id when signed in (web), else null
  source: string;                  // provenance: 'web' | 'twilio-sms' | 'twilio-whatsapp' | 'twilio-voice'
  sourceRef?: string | null;       // privacy-safe sender ref (e.g. hashed phone) — audit only, never PII
  // v1.2 feedback loop: RAW phone number, stored only with explicit citizen consent
  // (they typed it into the web form and it passed OTP). Deliberately distinct from
  // sourceRef above — Twilio-inbound submissions stay privacy-preserving (hash only,
  // no raw number) unless a citizen separately opts in via the web form.
  phone?: string | null;
  phoneVerified?: boolean;
};

export type IntakeResult =
  | { submission_id: string; status: "received" }
  | { submission_id: string; status: "processed"; cluster_id: string | null; category: string; ward: string; duplicate_of: string | null }
  | { submission_id: string; status: "failed"; code: string; message: string };

export async function persistAndProcess(input: IntakeInput): Promise<IntakeResult> {
  const id = randomUUID();

  // Ingest stays open (citizens submit before/without signing in). When a session
  // exists the row is stamped with the Google user id so the RLS citizen policy lets
  // them poll /api/submissions/:id. Twilio callers pass no userId (anonymous intake).
  // sender_ref: privacy-safe HMAC of the Twilio sender (never the raw number) —
  // persisted on the row so the WhatsApp STATUS command can list a citizen's own
  // complaints. Web submissions leave it null (user_id serves that purpose there).
  await db().query(
    `INSERT INTO submissions (id, status, channel, lang, raw_text, media_uri, ward, user_id, phone, phone_verified, sender_ref)
     VALUES ($1, 'received', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, input.channel, input.lang, input.rawText, input.mediaUri, input.ward, input.userId ?? null, input.phone ?? null, input.phoneVerified ?? false, input.sourceRef ?? null]
  );
  await db().query(
    "INSERT INTO audit_events (submission_id, stage, detail) VALUES ($1, 'received', $2)",
    [id, JSON.stringify({ channel: input.channel, source: input.source, source_ref: input.sourceRef ?? null, media_uri: input.mediaUri, ward_hint: input.ward })]
  );

  if (process.env.DEMO_MODE === "true") {
    // sync path (B1): same pipeline code as the worker, no Pub/Sub hop
    const { initWorker, processSubmission } = await import("../../../worker/ingest");
    await initWorker();
    const result = await processSubmission(id);
    if (result.status === "processed")
      return { submission_id: id, status: "processed", cluster_id: result.cluster_id, category: result.category, ward: result.ward, duplicate_of: result.duplicate_of };
    // failure already dead-lettered + status=failed by the pipeline — report loudly
    return { submission_id: id, status: "failed", code: "processing_failed", message: result.status === "failed" ? result.reason : "submission not in received state" };
  }

  try {
    await publishSubmission(id);
  } catch (e) {
    // row is safely persisted (replay picks up status=received) — but never silent:
    await db().query(
      "INSERT INTO deadletters (submission_id, failed_stage, reason, raw_response) VALUES ($1, 'received', 'pubsub_publish_failed', $2)",
      [id, String(e).slice(0, 4000)]
    );
    return { submission_id: id, status: "failed", code: "publish_failed", message: `submission ${id} persisted but Pub/Sub publish failed: ${e}` };
  }
  return { submission_id: id, status: "received" };
}
