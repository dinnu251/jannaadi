// POST /api/twilio/voice — inbound phone call ("A call comes in" webhook).
// Citizens who can't (or won't) use the app just call the number and speak their
// complaint. We greet them and record up to 60s; when the recording finishes Twilio
// POSTs it to /api/twilio/voice/recording, which ingests it as a voice submission.
import { verifyTwilio, parseFormBody, voiceRecordTwiml, signedUrlFor, voiceHangupTwiml } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const p = parseFormBody(await req.text());
    const reject = verifyTwilio(req, "/api/twilio/voice", p);
    if (reject) return reject;

    // Absolute action URL so Twilio (and our signature check on the callback) agree
    // on exactly which URL was signed.
    const action = signedUrlFor(req, "/api/twilio/voice/recording");
    return voiceRecordTwiml(action);
  } catch (e) {
    console.error(`[POST /api/twilio/voice] ${e instanceof Error ? e.stack ?? e.message : e}`);
    return voiceHangupTwiml("Sorry, we could not take your complaint right now. Please try again later.");
  }
}
