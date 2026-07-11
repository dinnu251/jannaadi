// POST /api/twilio/voice/recording — <Record> action callback.
// Twilio calls this when the caller finishes recording. We pull the WAV, store it in
// GCS, and enter it into the pipeline as a voice submission (STT → extraction happens
// downstream, exactly like a web voice upload). We reply with a goodbye TwiML so the
// call ends cleanly.
//
// Timing note: Twilio expects this webhook to respond within ~15s. In async mode
// (Pub/Sub) we persist + publish and return instantly. In DEMO_MODE the full STT +
// Gemini pipeline runs inline (single-call demo machine); the complaint still lands
// even if the goodbye prompt is clipped. See docs/TWILIO.md.
import { uploadMedia } from "@/lib/gcp";
import { ownerDb } from "@/lib/db";
import { persistAndProcess } from "@/lib/intake";
import { verifyTwilio, parseFormBody, downloadTwilioMedia, voiceHangupTwiml, senderRef } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const p = parseFormBody(await req.text());
    const reject = verifyTwilio(req, "/api/twilio/voice/recording", p);
    if (reject) return reject;

    const recordingUrl = p.RecordingUrl;
    const recordingSid = p.RecordingSid || "";
    const duration = parseInt(p.RecordingDuration ?? "0", 10) || 0;
    if (!recordingUrl || duration < 1) {
      return voiceHangupTwiml("We did not receive a recording. Please call again to file your complaint. Goodbye.");
    }

    // Idempotency (verified failure mode with a real call): DEMO_MODE processes
    // inline (~25s), Twilio times this callback out at ~15s and RETRIES with the
    // same RecordingSid — the retry double-ingested the complaint. The media object
    // is keyed by RecordingSid, so a row already referencing it means the first
    // attempt owns this recording: thank the caller and hang up, ingest nothing.
    if (recordingSid) {
      const { rows } = await ownerDb().query(
        "SELECT 1 FROM submissions WHERE media_uri LIKE $1 LIMIT 1", [`%/${recordingSid}.wav`]
      );
      if (rows.length) {
        console.log(`[twilio/voice/recording] duplicate callback for ${recordingSid} — skipping ingest`);
        return voiceHangupTwiml("Thank you. Your complaint has been recorded and will be reviewed. Goodbye.");
      }
    }

    // Twilio serves the recording as WAV at <RecordingUrl>.wav (PCM — STT reads the
    // RIFF header, no encoding hint needed). Basic-auth download happens in the helper.
    const { buffer, contentType } = await downloadTwilioMedia(`${recordingUrl}.wav`);
    const mediaUri = await uploadMedia(`media/${recordingSid || `rec-${Date.now()}`}.wav`, buffer, contentType || "audio/wav");

    const from = p.From ?? "";
    const result = await persistAndProcess({
      channel: "voice",
      lang: null,
      rawText: null,
      mediaUri,
      ward: null,
      source: "twilio-voice",
      sourceRef: from ? senderRef(from) : null,
    });

    if (result.status === "failed") console.error(`[twilio/voice/recording] intake failure: ${result.code} ${result.message}`);
    return voiceHangupTwiml("Thank you. Your complaint has been recorded and will be reviewed. Goodbye.");
  } catch (e) {
    console.error(`[POST /api/twilio/voice/recording] ${e instanceof Error ? e.stack ?? e.message : e}`);
    return voiceHangupTwiml("Sorry, we could not process your recording. Please try again later. Goodbye.");
  }
}
