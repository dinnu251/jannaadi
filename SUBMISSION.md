# JanNaadi — Submission

**Hackathon:** Build with AI: Code for Communities — Track 1  
**Team:** d_godaba  
**Date:** 8 July 2026  
**Live URL:** https://app.prasyn.com  
**Repo:** https://github.com/dinnu251/jannaadi

---

## What We Built

JanNaadi ("People's Voice") is an AI-native constituency development intelligence platform for Greater Visakhapatnam Municipal Corporation (GVMC) — built for **Track 1: AI for Constituency Development Planning**. MPs and ward officers receive development requests from 2.1M citizens across 98 wards through public meetings, social media, WhatsApp, and phone calls — but with no way to consolidate, rank, or match them against the city's own development plans.

JanNaadi solves this. Citizens submit via **5 channels** — web text/voice/photo, Twilio SMS/MMS, Twilio WhatsApp (text, photo, voice note), and Twilio phone calls — in Telugu, Hindi, English, or code-mixed Hinglish. Every channel funnels into the same `persistAndProcess` pipeline. Gemini 2.5 Flash extracts structured data, pgvector clusters semantically similar submissions across 98 wards, and a ranked dashboard surfaces high-priority development works — scored by frequency × severity × recency × demographic weight — that an MP or ward officer can act on. Clusters are matched against GVMC Master Plan 2041 clauses via Discovery Engine RAG, so every ranked item shows whether it aligns with existing plans or represents an unplanned demand gap.

---

## Problem

MPs and ward officers in Visakhapatnam receive development requests through public meetings, letters, WhatsApp, phone calls, and walk-ins — but these never get consolidated, never get prioritised against each other, and never get matched to the city's own Master Plan. There is no objective way to weigh a surge in school-upgrade requests against a proposed vocational centre, or to see which ward's drainage complaints have spiked without manual triage. Feature-phone users (calls/SMS) are excluded from digital feedback entirely. City investments lack real-time citizen demand evidence.

---

## Intake Channels

| Channel | Endpoint | What arrives |
|---|---|---|
| Web text | `POST /api/ingest` | Raw text |
| Web voice | `POST /api/ingest` | Audio blob → Cloud STT |
| Web photo | `POST /api/ingest` | Image + caption |
| Twilio SMS / MMS | `POST /api/twilio/sms` | Body + optional MediaUrl (photo) |
| Twilio WhatsApp text/photo/voice note | `POST /api/twilio/sms` | Same webhook, OGG_OPUS audio path |
| Twilio Phone Call | `POST /api/twilio/voice` → `POST /api/twilio/voice/recording` | WAV recording |

All channels call the same `persistAndProcess()` function — no duplicated logic, no schema differences.

**Twilio security:** Every webhook validates `X-Twilio-Signature` (HMAC-SHA1, sorted POST params, keyed by Auth Token) before any data enters the pipeline. Bad signature → 403, nothing processed. Phone numbers are stored only as `senderRef` (HMAC-SHA256 hash, 16 hex chars) — never in plaintext.

## Solution Architecture

```
Citizen
  ├── Web (text/voice/photo)  →  POST /api/ingest
  ├── SMS / MMS               →  POST /api/twilio/sms   ← HMAC-SHA1 validated
  ├── WhatsApp (txt/img/ogg)  →  POST /api/twilio/sms   ← same endpoint
  └── Phone call              →  POST /api/twilio/voice → /voice/recording
                                                          ↓
                                              persistAndProcess()
    │
    ├─ voice  → Google Cloud STT (te-IN / hi-IN / en-IN, WAV/OGG_OPUS) → transcript
    ├─ photo  → Gemini multimodal (image + caption)
    └─ text   → direct
    │
    ▼
Gemini 2.5 Flash (structured extraction)
  · responseSchema: category (8 enums), ward (98 enums), severity 1-5, summary_en, summary_original, lang
  · If ward=UNKNOWN + landmark text → Maps grounding pre-pass (groundLandmark)
    │
    ▼
text-embedding-004 → 768-dim vector
    │
    ▼
pgvector cosine similarity → cluster assignment (running-mean centroid, threshold 0.83)
    │
    ▼
Discovery Engine → plan_match (GVMC Master Plan 2041 clauses)
    │
    ▼
GET /api/dashboard  →  ranked cluster list (frequency 40% · severity 25% · recency 20% · demographic 15%)
```

---

## Google AI & Cloud Services Used

| Service | How Used |
|---|---|
| **Gemini 2.5 Flash** | Structured extraction with JSON schema, multimodal photo analysis, Telugu/Hindi/code-mix understanding |
| **Google Maps Grounding** | Pre-pass: landmark-only ward mentions resolved to official ward names (e.g. "near RK Beach" → Ward 27) |
| **Cloud STT** | Voice transcript in te-IN, hi-IN, en-IN — WAV (phone call), OGG_OPUS (WhatsApp voice note), MP3 (web) |
| **text-embedding-004** | 768-dim multilingual semantic embeddings for clustering |
| **Discovery Engine** | RAG over GVMC Master Plan 2041 (8 plan docs ingested) |
| **Cloud Run** | Containerised Next.js + worker, auto-scale to zero |
| **Cloud SQL (PostgreSQL + pgvector)** | Submissions, clusters, audit events, rank weights, dead-letter queue |
| **Secret Manager** | DATABASE_URL, GEMINI_API_KEY, TWILIO_AUTH_TOKEN, TWILIO_WEBHOOK_BASE_URL, AUTH_SECRET, etc. — never in code |
| **Google OAuth 2.0** | Admin authentication with role-gating (@gvmc.gov.in email check) |

## Third-Party Services

| Service | How Used |
|---|---|
| **Twilio Programmable Messaging** | SMS and WhatsApp intake — text, MMS photo, WhatsApp voice note (OGG_OPUS) |
| **Twilio Voice** | Inbound call → `<Record>` TwiML → WAV download → Cloud STT → pipeline |

---

## Key Technical Decisions

**Structured Output over free-form:** `responseSchema` with closed enum lists for category and ward prevents hallucinated outputs. Retries on schema violation before dead-lettering.

**Maps grounding as a separate pre-pass:** Gemini cannot combine `googleMaps` grounding tool with `responseMimeType: application/json` (API rejects it). We run grounding only when `ward=UNKNOWN`, then feed the result into the structured extraction call.

**TypeScript-side centroid updates:** pgvector has no `vector * scalar` operator. Running-mean centroid update (`(v * n + embedding[i]) / (n + 1)`) computed in application layer.

**GEMINI_MODEL env-var pin:** Bypasses stale `app_config` DB row without a migration — critical during rapid iteration.

**Idempotent replay:** `UPDATE submissions SET status='received' WHERE is_synthetic=true AND status='failed'` at replay start makes any proxy interruption recoverable.

**Twilio signature validation before any I/O:** `lib/twilio.ts::verifyTwilio()` reconstructs the exact signed URL (using `TWILIO_WEBHOOK_BASE_URL`, not the incoming Host header — critical for tunnel/proxy setups) and does a timing-safe comparison before touching the database.

**Privacy-preserving senderRef:** Phone numbers are hashed on intake via `senderRef()` (HMAC-SHA256, 16 hex chars) and the raw number is discarded. The hash is stable per sender for deduplication but cannot be reversed.

---

## Validation Evidence

| Criterion | Evidence |
|---|---|
| B1 Text intake | G01–G02, G06–G07, G10–G14: processed in < 15s, extraction JSON correct |
| B1 Voice intake | G03, G04, G08, G12, G15: Cloud STT → Gemini → cluster |
| B1 Photo intake | G05, G09: Gemini multimodal extracts category + ward from image + caption |
| B2 Gajuwaka drainage | Ward 75 Pedagantyada cluster: 25 submissions, surfaces as top drainage priority |
| B3 Code-mix | G13 (Telugu-English), G14 (Hinglish): correct category and ward |
| B14 Landmark resolution | G11 "near RK Beach" → Ward 27 VIP Road, `ward_resolved_via=maps_grounding` in audit_events |
| Golden pass rate | **8/8 text items** on live Gemini + Cloud SQL (no mocks) |
| Synthetic load | 800 rows ingested, 192+ clusters formed, rank weights applied |
| Auth | Google OAuth roundtrip verified: signin → session → ADMIN role gate |
| Twilio SMS webhook | HMAC-SHA1 signature validation verified end-to-end |
| Twilio voice call | `<Record>` TwiML → WAV callback → Cloud STT → Gemini pipeline tested |
| Privacy | `senderRef()` hash in audit_events — no raw phone numbers in DB |
| Security | No secrets in tracked files; `.gitignore` covers `.env*`, `gcp-credentials.json`, `*.dump` |
| **Demo video** | **[JanNaadi-demo-track1.mp4](assets/JanNaadi-demo-track1.mp4)** — 3-min golden path at app.prasyn.com |
| **F11 perf** | Dashboard verified < 2s load at app.prasyn.com (13 Jul 2026) |

---

## File Structure

```
jannaadi/
├── apps/web/          # Next.js 14 frontend + API routes
│   ├── app/           # App Router pages (dashboard, submit, admin)
│   ├── app/api/       # ingest, submissions, dashboard, plan-match
│   │   └── twilio/    # sms/, voice/, voice/recording/ — Twilio webhooks
│   └── lib/twilio.ts  # validateTwilioSignature, senderRef, verifyTwilio
├── worker/
│   └── ingest.ts      # Processing pipeline (STT → extract → embed → cluster)
├── db/
│   ├── seed.sql                # Schema: submissions, clusters, audit_events,
│   │                            #   deadletters, rank_weights, app_config (98 wards)
│   ├── rls_policies.sql        # Row-level security (citizen/admin isolation)
│   ├── trust_and_feedback.sql  # v1.2: phone, resolution_status, geo_verified,
│   │                            #   duplicate_of, citizen_trust table
│   └── plan_documents.sql      # Local GVMC dev-plan corpus (planmatch fallback)
├── scripts/
│   ├── golden.ts               # 15-item golden test runner
│   ├── golden-set.json         # Test cases (text/voice/photo × 3 languages)
│   ├── demo-reset.sh           # Restore the frozen demo snapshot
│   ├── snapshot.sh             # Cut a fresh demo snapshot
│   └── test-{geofence,dedup,trust}-e2e.ts   # v1.2 real end-to-end verification
├── data/
│   ├── synthetic.jsonl        # 800 synthetic submissions (ground truth)
│   └── raw-plans/             # GVMC Master Plan 2041 source docs
├── infra/
│   └── deploy.sh              # Cloud Run deploy script (web + worker services)
├── docs/
│   ├── DEMO.md                # Scripted demo path + pre-demo checklist
│   ├── GOLDEN.md              # Golden test spec
│   └── TWILIO.md              # Multi-modal Twilio intake integration
├── handovers/
│   ├── API.md                  # FROZEN frontend/backend contract (currently v1.2)
│   └── backend-status.json     # Evidence log — pass/fail/blocked per criterion
├── assets/golden/             # Voice clips (MP3) + photos for golden tests
├── README.md                  # Project entry point — start here
├── SECURITY.md                # Full security model
└── SUBMISSION.md              # This file
```

---

## How to Run Locally (Demo Setup)

```bash
# 1. Start Cloud SQL Auth Proxy
cloud-sql-proxy jannaadi:asia-south1:jannaadi-db --port=5433

# 2. Install & run dev server
npm install
npm run dev         # Next.js on :3000

# 3. Set TWILIO_WEBHOOK_BASE_URL in .env.local to https://app.prasyn.com
#    Configure Twilio console: SMS webhook → https://app.prasyn.com/api/twilio/sms
#                               Voice webhook → https://app.prasyn.com/api/twilio/voice

# 4. Run worker replay (seed 800 submissions)
$env:REPLAY="true"; $env:GEMINI_MODEL="gemini-2.5-flash"
npx tsx --env-file=.env.local worker/ingest.ts

# 5. Run golden tests (proxy must be running, dev server on :3000)
npx tsx --env-file=.env.local scripts/golden.ts

# 6. Verify results
npx tsx --env-file=.env.local scripts/verify.ts
```

**Required `.env.local` keys:**
`DATABASE_URL`, `WEB_DATABASE_URL`, `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PLAN_DATASTORE_ID`, `ADMIN_EMAILS`, `BASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_BASE_URL`

---

## Deployment (Cloud Run — deploy-ready)

```bash
# 1. Store secrets in Secret Manager (one-time)
gcloud secrets create TWILIO_AUTH_TOKEN --data-file=- <<< "$TWILIO_AUTH_TOKEN"
gcloud secrets create TWILIO_WEBHOOK_BASE_URL --data-file=- <<< "https://jannaadi.run.app"
# ... similarly for DATABASE_URL, GEMINI_API_KEY, etc.

# 2. Deploy
./infra/deploy.sh
```

`infra/deploy.sh` conditionally injects Twilio secrets only when `TWILIO_ACCOUNT_SID` is set in the environment, so the same script works with or without Twilio. Cloud Run service: `jannaadi` in `asia-south1`. Dockerfile uses multi-stage Node 20 build. On Cloud Run, `TWILIO_WEBHOOK_BASE_URL` is set to the Cloud Run service URL — no tunnel needed.

---

## v1.2 — Citizen trust & feedback loop (added post-initial-submission)

Five additive features shipped and verified end-to-end against real Cloud SQL, GCS, and
Twilio (not mocked) — full contract in [handovers/API.md](handovers/API.md) "v1.2
additions", evidence in [handovers/backend-status.json](handovers/backend-status.json):

- **OTP verification** (`POST /api/verify/send`, `/api/verify/check`) — Twilio Verify,
  short-lived HMAC-signed token binds a phone number to a submission with consent.
- **Feedback loop** (`PATCH /api/submissions/:id/status`, admin-only) — MP staff change
  a complaint's resolution status; the citizen gets an SMS/WhatsApp update automatically.
  This is the item originally listed under "What's Next" below — now shipped.
- **Photo geofencing** — EXIF GPS on photo submissions checked against the resolved
  ward (4km radius, same threshold as Maps grounding); `null` when no EXIF GPS present
  (never penalized — most phones strip location metadata by default).
- **Citizen trust scoring** — a hidden, phone-keyed reputation signal that gates which
  submissions count toward a cluster's *ranking* frequency, without ever appearing in
  any API response or changing the displayed `submission_count` (transparency preserved;
  the frontend's 4-component score-breakdown panel shape is unchanged).
- **AI dedup** — a near-identical resubmission from the same phone/account within 24h
  is linked via `duplicate_of` instead of inflating a cluster; a genuinely different
  citizen reporting the same real-world issue still clusters normally (verified as an
  explicit control case, not just the happy path).

All five are scoped to explicit, phone-opted-in submitters — the existing Twilio-inbound
privacy design (non-reversible `senderRef` hash, no raw phone stored) is untouched.

## What's Next

- Twilio WhatsApp WABA approval (production sender — sandbox works for demo)
- Ward councillor mobile app (push notifications on new clusters)
- Expand to all 13 ULBs in Visakhapatnam district
- Open API for third-party integrations 