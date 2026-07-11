// GET /api/config — public, unauthenticated.
// Returns non-secret client-side config the frontend needs at runtime.
// GOOGLE_MAPS_API_KEY lives only in Secret Manager / .env.local — never in git or the
// frontend bundle. The browser still sends it to maps.googleapis.com per the Maps JS
// API contract (all map tile requests carry it), but referrer-restriction on the GCP
// key prevents use from any domain other than your Cloud Run URL.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
    // Public complaint channels (demo surface: the SubmitPage renders a WhatsApp QR
    // + call number from these). All non-secret; env-driven so numbers/join codes
    // can change via a config-only revision, no rebuild.
    channels: {
      whatsappNumber: process.env.TWILIO_WA_NUMBER ?? "",     // e.g. +14155238886 (sandbox)
      whatsappJoinCode: process.env.TWILIO_WA_JOIN_CODE ?? "", // sandbox "join <two-words>", empty for prod WABA
      voiceNumber: process.env.TWILIO_VOICE_NUMBER ?? "",      // call-in number, optional
    },
  });
}
