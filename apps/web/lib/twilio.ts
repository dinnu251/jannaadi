// Twilio inbound helpers — signature validation, media download, TwiML builders —
// plus (below) v1.2 outbound: OTP verification and the status-update feedback loop.
//
// These webhooks are PUBLIC (no session): anyone can POST to them. The only thing
// standing between the open internet and the ingest pipeline is the X-Twilio-Signature
// HMAC, so validation here is a security boundary, not a nicety. Kept dependency-free
// (node:crypto only) so the offline/CODE_ONLY build has nothing new to install.
import { createHmac, timingSafeEqual } from "crypto";
import twilioSdk from "twilio";

// Provenance without PII: a stable, non-reversible ref for a sender phone number,
// keyed by the app secret. Lets us correlate a citizen's submissions in the audit
// trail without ever storing their number. Falls back to a fixed salt if unset.
export function senderRef(from: string): string {
  const salt = process.env.AUTH_SECRET || process.env.TWILIO_AUTH_TOKEN || "jannaadi";
  return createHmac("sha256", salt).update(from).digest("hex").slice(0, 16);
}

// ── Signature validation ─────────────────────────────────────
// Twilio signs: full_url + concat(sorted(paramKey + paramValue)), HMAC-SHA1 with the
// account Auth Token, base64. https://www.twilio.com/docs/usage/security#validating-requests
export function validateTwilioSignature(
  authToken: string,
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .reduce((acc, k) => acc + k + params[k], "");
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Reconstruct the exact URL Twilio signed. Twilio hashes the URL configured in the
// console, which on Cloud Run is the *public* https URL — not the internal one the
// container sees. Prefer an explicit override; otherwise derive from the forwarded
// proxy headers. Query string is included because Twilio signs it when present.
export function signedUrlFor(req: Request, pathname: string, search = ""): string {
  const override = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.BASE_URL || process.env.AUTH_URL;
  if (override) return `${override.replace(/\/$/, "")}${pathname}${search}`;
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}${pathname}${search}`;
}

// Gate a webhook: returns null when the request is authentic (or validation is
// intentionally disabled locally), or a 403 Response when it must be rejected.
// Validation is REQUIRED whenever TWILIO_AUTH_TOKEN is set. With no token (local
// dev / DEMO without Twilio creds) it is skipped, and that skip is logged loudly.
export function verifyTwilio(req: Request, pathname: string, params: Record<string, string>, search = ""): Response | null {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    // Fail CLOSED in production: a missing token must never silently disable the only
    // security boundary on these public webhooks. Skipping is a dev-only convenience.
    if (process.env.NODE_ENV === "production") {
      console.error(`[twilio] TWILIO_AUTH_TOKEN unset in production — refusing ${pathname} (fail-closed)`);
      return new Response("Forbidden", { status: 403 });
    }
    console.warn(`[twilio] TWILIO_AUTH_TOKEN unset — skipping signature validation for ${pathname} (dev only; NEVER in prod)`);
    return null;
  }
  const ok = validateTwilioSignature(token, req.headers.get("x-twilio-signature"), signedUrlFor(req, pathname, search), params);
  if (!ok) {
    console.error(`[twilio] signature validation FAILED for ${pathname}`);
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

// ── Media download ───────────────────────────────────────────
// Twilio media (MMS/WhatsApp attachments, call recordings) sits behind HTTP Basic
// Auth with the account SID + Auth Token. Returns the bytes + resolved content-type
// (the MediaUrl 302-redirects to a CDN; fetch follows it by default).
export async function downloadTwilioMedia(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN unset — cannot fetch Twilio media");
  const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } });
  if (!res.ok) throw new Error(`Twilio media fetch ${res.status} for ${url}`);
  const contentType = res.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

// ── Modality mapping ─────────────────────────────────────────
// Map a Twilio media content-type onto a JanNaadi channel + storage extension.
// Mirrors the accepted types in /api/ingest, plus ogg for WhatsApp voice notes.
const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png" };
const AUDIO_EXT: Record<string, string> = {
  "audio/ogg": "ogg", "audio/opus": "ogg", // WhatsApp voice notes are OGG/Opus
  "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm",
  "audio/amr": "amr", // some carriers send AMR MMS audio
};
export function classifyMedia(contentType: string): { channel: "photo" | "voice"; ext: string } | null {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (IMAGE_EXT[ct]) return { channel: "photo", ext: IMAGE_EXT[ct] };
  if (AUDIO_EXT[ct]) return { channel: "voice", ext: AUDIO_EXT[ct] };
  return null;
}

// ── TwiML builders ───────────────────────────────────────────
// Hand-built XML: our replies are trivial and the twilio SDK would be a heavy dep
// for two element types. escapeXml guards against `&`/`<` in dynamic summaries.
function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

export function messagingReply(message: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

export function emptyMessagingReply(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', { headers: { "Content-Type": "text/xml" } });
}

// Voice-call TwiML: greet the caller, record up to 60s, POST the recording to
// `recordingAction`. finishOnKey lets the caller press # to stop early.
export function voiceRecordTwiml(recordingAction: string): Response {
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say language="en-IN">Welcome to Jan Naadi. Please describe your civic complaint after the beep. Press hash when finished.</Say>` +
    `<Record maxLength="60" playBeep="true" finishOnKey="#" trim="trim-silence" ` +
    `action="${escapeXml(recordingAction)}" method="POST"/>` +
    `<Say language="en-IN">We did not receive a recording. Goodbye.</Say>` +
    `</Response>`;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

export function voiceHangupTwiml(message: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-IN">${escapeXml(message)}</Say><Hangup/></Response>`;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

// Parse an application/x-www-form-urlencoded Twilio POST body into a flat string map.
// (We read the raw text so the exact bytes are available for signature validation.)
export function parseFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  new URLSearchParams(body).forEach((v, k) => { params[k] = v; });
  return params;
}

// ── v1.2: OTP verification + outbound status-update feedback loop ──────────
// Separate REST client (not the TwiML-reply flow above) — these call Twilio's
// Verify and Messaging APIs directly to send/check OTPs and push notifications.
const g = globalThis as unknown as { __twilioClient?: ReturnType<typeof twilioSdk>; __verifyServiceSid?: string };

function client() {
  if (!g.__twilioClient) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set");
    g.__twilioClient = twilioSdk(sid, token);
  }
  return g.__twilioClient;
}

// A dedicated Verify Service is required by the Twilio Verify API. Reused if already
// created (idempotent) so there's no manual one-time console step.
async function verifyServiceSid(): Promise<string> {
  if (g.__verifyServiceSid) return g.__verifyServiceSid;
  if (process.env.TWILIO_VERIFY_SERVICE_SID) return (g.__verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID);
  const services = await client().verify.v2.services.list({ limit: 20 });
  const existing = services.find((s) => s.friendlyName === "JanNaadi");
  if (existing) return (g.__verifyServiceSid = existing.sid);
  const created = await client().verify.v2.services.create({ friendlyName: "JanNaadi" });
  return (g.__verifyServiceSid = created.sid);
}

export async function sendOtp(phone: string): Promise<void> {
  const sid = await verifyServiceSid();
  await client().verify.v2.services(sid).verifications.create({ to: phone, channel: "sms" });
}

export async function checkOtp(phone: string, code: string): Promise<boolean> {
  const sid = await verifyServiceSid();
  try {
    const check = await client().verify.v2.services(sid).verificationChecks.create({ to: phone, code });
    return check.status === "approved";
  } catch (e) {
    // Twilio throws (not a rejected-status response) for "no pending verification for
    // this number" (404), an already-consumed code, or a malformed check — all of
    // these mean "not verified," not a server error. Anything else still surfaces.
    const status = (e as { status?: number }).status;
    if (status === 404 || status === 400) return false;
    throw e;
  }
}

// Short-lived, phone-scoped signed token proving a phone passed OTP check (HMAC-SHA256
// over AUTH_SECRET — same trust root as the session cookie, no extra table needed for
// a 15-min-lived credential). Format: "<phone>.<expiryMs>.<sig>".
const VERIFY_TOKEN_TTL_MS = 15 * 60 * 1000;

export function mintVerifyToken(phone: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET not set — cannot mint verify_token");
  const exp = Date.now() + VERIFY_TOKEN_TTL_MS;
  const payload = `${phone}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function checkVerifyToken(phone: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokPhone, expStr, sig] = parts;
  if (tokPhone !== phone) return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = createHmac("sha256", secret).update(`${tokPhone}.${expStr}`).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Outbound status-change notification (v1.2 feedback loop, PROMPTS.md task 13).
// SMS by default; pass whatsapp:true to send via the Twilio WhatsApp number instead.
export async function sendStatusUpdate(phone: string, resolutionStatus: string, note: string | null, whatsapp = false): Promise<void> {
  const from = whatsapp ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;
  if (!from) throw new Error(`${whatsapp ? "TWILIO_WHATSAPP_FROM" : "TWILIO_SMS_FROM"} not set`);
  const statusText: Record<string, string> = {
    acknowledged: "has been acknowledged",
    in_progress: "is now being worked on",
    resolved: "has been resolved",
  };
  const body = `JanNaadi: Your complaint ${statusText[resolutionStatus] ?? `status changed to ${resolutionStatus}`}.${note ? ` Note: ${note}` : ""}`;
  await client().messages.create({
    to: whatsapp ? `whatsapp:${phone}` : phone,
    from: whatsapp ? `whatsapp:${from}` : from,
    body,
  });
}
