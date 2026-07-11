# JanNaadi (జన్ నాడి) — "People's Voice"

An AI-native civic intelligence platform for the Greater Visakhapatnam Municipal
Corporation (GVMC). Citizens report civic issues — potholes, drainage, water supply,
garbage, streetlights — over **five channels** in Telugu, Hindi, English, or code-mixed
Hinglish. An AI pipeline transcribes, extracts structured data, clusters semantically
similar reports across 98 wards, and matches them against the city's own development
plans. MP/ward staff see a ranked, explainable priority dashboard driving real action.

**Live app:** see `handovers/backend-status.json` for the current deployed URL (Cloud Run
URLs are re-issued on redeploy — always confirm via `gcloud run services describe`).

---

## Why this exists

Visakhapatnam's 2M+ citizens have no single channel to report civic issues in their own
language. Complaints scatter across WhatsApp groups, phone calls, and walk-ins — never
aggregated, never prioritized, never checked against what the city already planned to fix.
Feature-phone users are excluded from every existing digital feedback channel. JanNaadi
collapses all of that into one pipeline with one ranked, auditable output.

## How a complaint gets processed

```
Citizen (5 intake channels)                       AI pipeline (worker/ingest.ts)
├─ Web text/voice/photo   → POST /api/ingest   ┐
├─ SMS / MMS              → /api/twilio/sms    │   1. transcribe (Cloud STT, voice only)
├─ WhatsApp text/photo/   → /api/twilio/sms    ├─▶ 2. extract (Gemini, JSON schema,
│  voice note                                   │      closed enums: category/ward/severity)
└─ Phone call             → /api/twilio/voice  ┘   3. embed (768-dim, text-embedding-004)
                                                    4. resolve ward (extraction → Maps
                                                       grounding pre-pass → citizen hint)
                                                    5. geofence photo EXIF GPS vs ward
                                                    6. dedup vs. same-submitter history
                                                    7. cluster (pgvector cosine, θ=0.83)
                                                    8. match against GVMC dev plans
                                                       (Discovery Engine / local corpus)
                                                          │
                                                          ▼
                                          GET /api/rank — ranked, explainable priorities
                                          (frequency 40% · severity 25% · recency 20% ·
                                           demographic 15%, live-tunable, no redeploy)
                                                          │
                                                          ▼
                                     MP dashboard: ranked list, score breakdown, heatmap,
                                     dead-letter admin view, "in dev plan" badges
                                                          │
                                                          ▼
                        PATCH /api/submissions/:id/status → SMS/WhatsApp status update
                                     back to the citizen (feedback loop)
```

Every intake channel funnels through the same `persistAndProcess()` function
([apps/web/lib/intake.ts](apps/web/lib/intake.ts)) — no duplicated logic, no
channel-specific schema. Nothing fails silently: every pipeline stage writes an
`audit_events` row, every failure writes a `deadletters` row, both visible via the API.

## Feature set

| Area | What it does | Where |
|---|---|---|
| Multi-channel intake | Web (text/voice/photo), SMS, WhatsApp, phone call | [apps/web/lib/intake.ts](apps/web/lib/intake.ts), [apps/web/app/api/twilio](apps/web/app/api/twilio) |
| AI extraction | Gemini, JSON-schema-constrained, 3 languages + code-mix | [worker/ingest.ts](worker/ingest.ts) |
| Ward resolution | Extraction → Google Maps grounding pre-pass → citizen hint | [worker/ingest.ts](worker/ingest.ts) `groundLandmark`/`resolveWardFromLatLng` |
| Semantic clustering | pgvector cosine similarity, running-mean centroid | [worker/ingest.ts](worker/ingest.ts) `assignCluster` |
| Explainable ranking | 4-factor weighted score, live-tunable via DB, no redeploy | [api/rank.sql](api/rank.sql) |
| Plan matching | Clusters matched against real GVMC dev-plan documents | [worker/planmatch.ts](worker/planmatch.ts) |
| Auth & RBAC | Google OAuth, citizen vs. admin roles, Postgres RLS | [apps/web/auth.ts](apps/web/auth.ts), [db/rls_policies.sql](db/rls_policies.sql) |
| OTP verification | Twilio Verify, phone opt-in for the feedback loop | [apps/web/app/api/verify](apps/web/app/api/verify) |
| Feedback loop | Admin status change → SMS/WhatsApp to the citizen | [apps/web/app/api/submissions/\[id\]/status](apps/web/app/api/submissions/[id]/status) |
| Photo geofencing | EXIF GPS checked against the claimed ward | [worker/ingest.ts](worker/ingest.ts) `checkPhotoGeofence` |
| Trust scoring | Hidden, phone-keyed reputation gating ranking eligibility | [worker/ingest.ts](worker/ingest.ts) `adjustTrust`, [api/rank.sql](api/rank.sql) |
| AI dedup | Near-identical resubmissions don't inflate a cluster | [worker/ingest.ts](worker/ingest.ts) `findDuplicate` |
| Dead-letter admin | Every failure visible, nothing silent | [apps/web/app/api/deadletters](apps/web/app/api/deadletters) |

The last five rows (OTP, feedback loop, geofencing, trust, dedup) are the **v1.2**
addition — see [handovers/API.md](handovers/API.md) "v1.2 additions" for the exact
contract, and [PROMPTS.md](PROMPTS.md) tasks 12–16 for how they were scoped.

## Repo map

```
apps/web/            Next.js 15 App Router — all API routes + the auth server
  app/api/            ingest, submissions/:id(/status), rank, heatmap, deadletters,
                       wards, verify/{send,check}, twilio/{sms,voice,voice/recording},
                       config, healthz, auth/[...nextauth]
  lib/                db (RLS DAL), gcp (GCS/Pub-Sub), twilio, intake, ranksql,
                       ratelimit, health, twilio-pending, api
  auth.ts             Auth.js v5, Google-only, role from ADMIN_EMAILS
frontend/             Vite + React SPA (citizen submit page, MP dashboard, admin views)
  src/pages/           SubmitPage, DashboardPage, DeadLettersPage, LoginPage
  src/components/      Heatmap (Google Maps + static fallback)
worker/               Standalone pipeline worker (Pub/Sub consumer or REPLAY mode)
  ingest.ts            The whole stage machine: transcribe→extract→embed→ward→
                       geofence→dedup→cluster→trust
  planmatch.ts         Discovery Engine (or local corpus) plan matching
db/                    seed.sql (schema), rls_policies.sql, trust_and_feedback.sql (v1.2),
                       plan_documents.sql
api/rank.sql           The ranking query — single source of truth for score_breakdown
scripts/                golden.ts/.sh (15-case gate), demo-reset.sh, snapshot.sh,
                       various *-e2e.ts verification scripts, clean-wards.ts
infra/deploy.sh         Cloud Run deploy (web + worker services)
handovers/              API.md (frozen contract), backend-status.json (evidence log),
                       acceptance/backend.md (B1–B15 criteria)
docs/                   DEMO.md, GOLDEN.md, TWILIO.md, DECK.md
```

## Quick start (local)

Prereqs: Node 20+, a Postgres 15+ instance with `pgvector` (Cloud SQL Auth Proxy for the
real deployment DB, or local Docker `pgvector/pgvector:pg16` for isolated dev), and the
env vars listed below in `apps/web/.env.local`.

```bash
npm install                      # installs root + apps/web workspaces
npm run dev                      # Next.js dev server on :3000 (apps/web)

# separately, in another shell (frontend SPA, proxied to :3000 in dev):
cd frontend && npm install && npm run dev

# process a batch of seeded submissions through the real pipeline:
npm run replay                   # REPLAY=true worker/ingest.ts

# run the 15-case golden gate against a running DEMO_MODE server:
BASE_URL=http://localhost:3000 npm run golden
```

Required env vars (`apps/web/.env.local`, never committed — see `.gitignore`):
`DATABASE_URL`, `WEB_DATABASE_URL`, `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`,
`AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`,
`GCP_PROJECT`, `GCS_BUCKET`, `PLAN_DATASTORE_ID` (optional — falls back to a local plan
corpus), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WEBHOOK_BASE_URL` (optional
— Twilio channels degrade gracefully without it).

## Deploy

```bash
GCP_PROJECT=... GCS_BUCKET=... INSTANCE_CONNECTION_NAME=proj:region:instance \
  RUNTIME_SERVICE_ACCOUNT=... ./infra/deploy.sh
```

Deploys two Cloud Run services from one image (`APP_ROLE=web|worker` picks the entry
point): `jannaadi` (the Next.js app + API) and `jannaadi-worker` (Pub/Sub consumer,
`min-instances=1`, always-on). See [infra/deploy.sh](infra/deploy.sh) for every flag and
[SECURITY.md](SECURITY.md) for the secrets/IAM this expects.

**Known platform quirk:** the bare `/healthz` path is reserved by Google's edge on the
default `*.run.app` domain and never reaches the container — health checks must hit
`/api/healthz`. If you need `/healthz` specifically reachable (e.g. a monitoring tool
that assumes the literal path), front the service with an External HTTPS Load Balancer +
Serverless NEG, which isn't subject to that restriction.

## Testing & verification

- **`scripts/golden.ts`** — 15 fixed inputs (all 3 languages, all 3 web channels,
  code-mixed text, a landmark-only Maps-grounding case) run through the real pipeline
  against a `DEMO_MODE=true` server; asserts category/ward/severity land correctly.
- **`scripts/verify-local.ts`** — 46+ checks against a local Postgres fixture: contract
  shapes, RLS enforcement (citizen/admin/anonymous), B9/B10 ranking math, B5 idempotency.
- **`scripts/test-{geofence,dedup,trust}-e2e.ts`** — real end-to-end verification of the
  v1.2 pipeline additions against live Cloud SQL/GCS (not mocked).
- **`scripts/demo-reset.sh`** — restores the frozen 800-submission demo snapshot and
  asserts exact counts + the real `/api/rank` top-1, for a clean pre-demo state.

Every verification run's evidence is logged to `logs/` (gitignored) and referenced from
[handovers/backend-status.json](handovers/backend-status.json), which is the
authoritative pass/fail/blocked record per acceptance criterion (B1–B15,
[handovers/acceptance/backend.md](handovers/acceptance/backend.md)) — "no evidence file,
no pass," per the project's own rule.

## Security

See [SECURITY.md](SECURITY.md) for the full model: authentication/RBAC, RLS as a
backstop (not the only gate), Twilio webhook signature validation, rate limiting, secret
handling, PII policy (phone numbers are never stored raw from anonymous Twilio senders —
only a non-reversible HMAC), and the known hardening backlog.

## Contract

[handovers/API.md](handovers/API.md) is the frozen frontend/backend contract — the
single source of truth for every request/response shape, versioned (currently v1.2, all
additions additive). Frontend and backend are built against this contract independently;
changes require a version bump and both sides' status files reset.

## Further reading

- [SUBMISSION.md](SUBMISSION.md) — hackathon submission narrative, Google AI/Cloud
  services used, validation evidence, key technical decisions
- [docs/DEMO.md](docs/DEMO.md) — the scripted demo path and pre-demo checklist
- [docs/GOLDEN.md](docs/GOLDEN.md) — the 15 golden test cases in detail
- [docs/TWILIO.md](docs/TWILIO.md) — the multi-modal Twilio intake integration
- [PROMPTS.md](PROMPTS.md) — the full task history/spec each build agent worked from
