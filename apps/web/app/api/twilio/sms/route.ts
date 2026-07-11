// POST /api/twilio/sms — inbound SMS, MMS, and WhatsApp messages.
// One Twilio "A message comes in" webhook serves all three (WhatsApp senders arrive
// with a `whatsapp:` address prefix). Multi-modal by construction:
//   - text body            → channel=text
//   - image attachment      → channel=photo (Body becomes the caption)
//   - audio attachment      → channel=voice (WhatsApp voice notes, AMR/MP3 MMS)
// Media is pulled from Twilio (Basic-auth), stored in GCS, and the message enters the
// exact same pipeline as a web submission via persistAndProcess. Replies with TwiML.
import { randomUUID } from "crypto";
import { uploadMedia } from "@/lib/gcp";
import { persistAndProcess } from "@/lib/intake";
import {
  verifyTwilio, parseFormBody, classifyMedia, downloadTwilioMedia,
  messagingReply, senderRef,
} from "@/lib/twilio";
import { setPending, takePending } from "@/lib/twilio-pending";
import { rateLimit } from "@/lib/ratelimit";
import { ownerDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto + pg + gcs — not edge
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const p = parseFormBody(raw);

    const reject = verifyTwilio(req, "/api/twilio/sms", p);
    if (reject) return reject;

    const from = p.From ?? "";
    // Per-sender throttle (keyed by number, since all Twilio traffic shares Twilio IPs).
    // Friendly TwiML, not 429 — a non-200 makes Twilio retry and double-ingest.
    if (from) {
      const rl = rateLimit(`twilio:${from}`, 12, 60_000);
      if (!rl.ok) return messagingReply("You're sending complaints very quickly. Please wait a minute and try again. — JanNaadi");
    }
    const isWhatsApp = from.startsWith("whatsapp:");
    const source = isWhatsApp ? "twilio-whatsapp" : "twilio-sms";
    const body = (p.Body ?? "").trim();
    const numMedia = parseInt(p.NumMedia ?? "0", 10) || 0;

    // STATUS command — citizens track their own complaints without any login:
    // "STATUS" lists their recent complaints; "STATUS <ref>" narrows to one.
    // Scoped by sender_ref = HMAC(their own number), so it can only ever return
    // the requester's rows (see ownerDb() note in lib/db.ts).
    const statusMatch = numMedia === 0 && body.match(/^status(?:\s+([0-9a-f]{4,12}))?$/i);
    if (statusMatch && from) {
      return statusReply(senderRef(from), statusMatch[1]?.toLowerCase() ?? null);
    }

    let channel: "text" | "voice" | "photo" = "text";
    let mediaUri: string | null = null;
    let rawText: string | null = body || null;

    if (numMedia > 0) {
      // Take the first attachment; a single complaint rarely carries more, and the
      // pipeline works per-submission. (Extra attachments are acknowledged, not lost
      // to a crash — they simply aren't ingested; documented in docs/TWILIO.md.)
      const url = p.MediaUrl0;
      const kind = classifyMedia(p.MediaContentType0 ?? "");
      if (!url || !kind) {
        return messagingReply("Sorry, that attachment type isn't supported. Please send a photo (JPG/PNG), a voice note, or describe your complaint in text.");
      }
      const { buffer, contentType } = await downloadTwilioMedia(url);
      mediaUri = await uploadMedia(`media/${randomUUID()}.${kind.ext}`, buffer, contentType);
      channel = kind.channel;
      rawText = kind.channel === "photo" ? (body || null) : null; // photo: caption; voice: transcript comes later
    } else if (!body) {
      return messagingReply("Please describe your civic complaint, or attach a photo or voice note. Example: \"Drainage overflowing near the school.\"");
    }

    const ref = from ? senderRef(from) : null;

    // Conversational ward recovery: if this sender has a complaint awaiting a location
    // and now replied with text, treat that reply as the locality and re-ingest the two
    // combined so the ward-resolution ladder can place it.
    if (ref && channel === "text" && rawText) {
      const pending = takePending(ref);
      // Lead with the locality the citizen just gave so Maps grounding anchors on it,
      // not on any place named in the original complaint.
      if (pending) rawText = `Location: ${rawText}. Complaint: ${pending}`;
    }

    const result = await persistAndProcess({
      channel,
      lang: null,          // auto-detect (te/hi/en) downstream — SMS gives no reliable hint
      rawText,
      mediaUri,
      ward: null,          // no ward via SMS; the worker's Maps-grounding ladder resolves it
      source,
      sourceRef: ref,
    });

    if (result.status === "processed") {
      return messagingReply(
        `✓ Complaint registered: ${result.category} in ${result.ward}. Ref: ${result.submission_id.slice(0, 8)}. Thank you — JanNaadi.`
      );
    }
    // Ward couldn't be resolved: don't drop the citizen with a generic ack. Stash the
    // complaint text and ask for their locality; their next reply threads back here.
    if (result.status === "failed" && /ward_unresolvable/.test(result.message)) {
      if (ref && rawText) setPending(ref, rawText);
      console.warn(`[twilio/sms] ward_unresolvable — asked sender for locality`);
      return messagingReply(
        "Got your complaint — but we couldn't tell which area it's in. Reply with your locality or PIN code (e.g. Gajuwaka, MVP Colony, or 530044) and we'll register it."
      );
    }
    if (result.status === "failed") {
      // The row is persisted or dead-lettered; tell the citizen it's received, not that
      // our internals hiccuped. The audit/deadletter trail carries the real reason.
      console.error(`[twilio/sms] intake reported failure: ${result.code} ${result.message}`);
      return messagingReply(`We received your complaint (Ref: ${result.submission_id.slice(0, 8)}) and are processing it. Thank you — JanNaadi.`);
    }
    return messagingReply(`✓ Complaint received (Ref: ${result.submission_id.slice(0, 8)}). We're processing it now. Thank you — JanNaadi.`);
  } catch (e) {
    console.error(`[POST /api/twilio/sms] ${e instanceof Error ? e.stack ?? e.message : e}`);
    // 200 with an apologetic TwiML: a 500 makes Twilio retry the whole message, which
    // would double-ingest anything that got past persist. Surface the failure in logs.
    return messagingReply("Sorry, something went wrong on our side. Please try again shortly. — JanNaadi");
  }
}

// "STATUS" / "STATUS <ref>" — list the sender's own complaints. sender_ref scoping
// means this can only ever surface rows created from the requesting number.
const STATUS_LABEL: Record<string, string> = {
  received: "Received", transcribed: "Processing", extracted: "Processing",
  clustered: "Processing", processed: "✓ Registered", failed: "Needs attention",
};
async function statusReply(ref: string, refPrefix: string | null): Promise<Response> {
  try {
    const params: unknown[] = [ref];
    let where = "sender_ref = $1";
    if (refPrefix) { where += " AND id::text LIKE $2"; params.push(`${refPrefix}%`); }
    const { rows } = await ownerDb().query(
      `SELECT LEFT(id::text, 8) AS ref, status, category, ward, submitted_at
       FROM submissions WHERE ${where} ORDER BY submitted_at DESC LIMIT 5`, params as any[]
    );
    if (!rows.length) {
      return messagingReply(refPrefix
        ? `No complaint found with ref ${refPrefix} from this number. Send STATUS to list your recent complaints.`
        : "No complaints found from this number yet. Describe your civic issue (text, photo, or voice note) to file one. — JanNaadi");
    }
    const lines = rows.map((r) => {
      const date = new Date(r.submitted_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      const what = [r.category, r.ward].filter(Boolean).join(" in ") || "processing";
      return `${STATUS_LABEL[r.status] ?? r.status} — ${what} (Ref ${r.ref}, ${date})`;
    });
    return messagingReply(`Your complaint${rows.length > 1 ? "s" : ""}:\n${lines.join("\n")}\n— JanNaadi`);
  } catch (e) {
    console.error(`[twilio/sms STATUS] ${e instanceof Error ? e.message : e}`);
    return messagingReply("Sorry, we couldn't fetch your complaint status right now. Please try again shortly. — JanNaadi");
  }
}
