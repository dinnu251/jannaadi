# Twilio Integration — Multi-modal Complaint Capture

Lets citizens file civic complaints over **SMS, WhatsApp, and phone calls** — no app
required. Every channel funnels into the *same* processing pipeline as the web form
(`persistAndProcess` → worker stage machine), so transcription, extraction, ward
resolution, clustering, audit, and dead-lettering all behave identically.

## Modality mapping

Twilio's transports collapse onto JanNaadi's three existing channels — no schema
change, no new pipeline code:

| Citizen sends | Arrives as | JanNaadi channel | Pipeline path |
|---|---|---|---|
| SMS text | `Body`, `NumMedia=0` | `text` | extract |
| WhatsApp text | `Body`, `whatsapp:` sender | `text` | extract |
| MMS / WhatsApp photo | `MediaUrl0` `image/*` | `photo` | multimodal extract (Gemini reads the image) |
| WhatsApp voice note | `MediaUrl0` `audio/ogg` | `voice` | STT (OGG_OPUS) → extract |
| Phone call | `<Record>` → WAV | `voice` | STT (WAV) → extract |

## Endpoints (public webhooks)

| Route | Twilio config slot |
|---|---|
| `POST /api/twilio/sms` | Phone number → Messaging → "A message comes in"; WhatsApp sender inbound webhook |
| `POST /api/twilio/voice` | Phone number → Voice → "A call comes in" |
| `POST /api/twilio/voice/recording` | set automatically (the `<Record action>` URL) |

These are **unauthenticated** by design (Twilio has no JanNaadi session). The security
boundary is the `X-Twilio-Signature` HMAC — see below.

## Setup

1. **Credentials** (`.env.local` / Cloud Run env):
   ```
   TWILIO_ACCOUNT_SID=ACxxxx…
   TWILIO_AUTH_TOKEN=xxxx…
   TWILIO_WEBHOOK_BASE_URL=https://<your-public-host>   # exact host Twilio calls
   ```
2. **Point Twilio at the webhooks** (Console, CLI, or API). Local dev: expose with
   `ngrok http 3000` and set `TWILIO_WEBHOOK_BASE_URL` to the ngrok URL.
   ```
   twilio phone-numbers:update <PN_SID> \
     --sms-url  https://<host>/api/twilio/sms \
     --voice-url https://<host>/api/twilio/voice
   ```
3. **WhatsApp**: configure the same `/api/twilio/sms` URL as the sender's inbound
   webhook (Sandbox for dev, an approved WABA sender for prod).

## Security

- Every webhook validates `X-Twilio-Signature` (HMAC-SHA1 of the exact signed URL +
  sorted POST params, keyed by the Auth Token) in `lib/twilio.ts` before any work.
  A bad/missing signature → `403`, nothing enters the pipeline.
- The URL Twilio signed is reconstructed from `TWILIO_WEBHOOK_BASE_URL` (preferred) or
  the forwarded proxy headers. If the base is wrong, **valid requests will 403** — this
  is the first thing to check when live traffic is rejected.
- If `TWILIO_AUTH_TOKEN` is unset, validation is **skipped** (a loud warning is logged).
  This is for local dev only — never deploy without the token.
- Inbound `Body` is untrusted input. It reaches Gemini only as *user content* (the
  extraction prompt is fixed, enum-constrained JSON), never concatenated into system text.
- **Privacy:** sender phone numbers are never stored. Provenance is recorded as a
  non-reversible `senderRef` (HMAC of the number) in `audit_events.detail`, alongside a
  `source` tag (`twilio-sms` / `twilio-whatsapp` / `twilio-voice`).

## Media handling

Twilio media (MMS/WhatsApp attachments, call recordings) sits behind HTTP Basic auth
(`ACCOUNT_SID:AUTH_TOKEN`). Each webhook downloads the bytes, uploads them to GCS via the
shared `uploadMedia`, and stores the `gs://` URI on the submission — the worker's STT and
Gemini `fileData` read straight from GCS, same as a web upload. GCS is therefore required
for photo/voice channels (text-only SMS works without it).

## Operational notes

- **Webhook timeout:** Twilio expects a reply within ~15s. In async mode (Pub/Sub) each
  webhook persists + publishes and returns instantly. In `DEMO_MODE=true` the full STT +
  Gemini pipeline runs inline; for a single-call demo this is fine, but a long voice
  recording can clip the goodbye prompt — the complaint still lands.
- **Multiple attachments:** only the first (`MediaUrl0`) is ingested per message; extra
  attachments are acknowledged, not processed. One complaint ≈ one attachment in practice.
- **Failures never surface to the citizen as errors:** the webhook always replies with a
  friendly ack; the real reason lives in `audit_events` / `deadletters` (visible in
  `/api/deadletters`).
