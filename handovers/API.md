# API.md — Frontend/Backend Contract
Status: contract-v1.2 — feedback loop + trust/verification additions (all additive, optional, nullable; nothing in v1/v1.1 removed or changed shape). See "v1.2 additions" section below. Changes after freeze require both agents' status files reset.

Base: Cloud Run service, asia-south1. All responses JSON. Errors: `{ "error": { "code": string, "message": string } }`.

---

## POST /api/ingest
Citizen submission. Returns immediately after raw persist (async processing) unless DEMO_MODE=true (sync).

Request (multipart/form-data):
| Field | Type | Required | Notes |
|---|---|---|---|
| channel | "text" \| "voice" \| "photo" | yes | |
| lang_hint | "te" \| "hi" \| "en" \| "auto" | no | default auto |
| text | string | if channel=text | max 2000 chars |
| audio | file (webm/wav/mp3) | if channel=voice | max 60s |
| image | file (jpg/png) | if channel=photo | max 5MB |
| caption | string | no | photo caption |
| ward | string | no | citizen-selected, from /api/wards enum |
| phone | string | no | v1.2. E.164 (+91...). Enables SMS/WhatsApp status updates. |
| verify_token | string | no | v1.2. From POST /api/verify/check. Marks phone_verified=true if valid for this phone. Submission is NEVER blocked without it — open intake preserved. |

Response 202:
```json
{ "submission_id": "uuid", "status": "received" }
```
DEMO_MODE response 200:
```json
{ "submission_id": "uuid", "status": "processed", "cluster_id": "uuid|null", "category": "drainage", "duplicate_of": "uuid|null" }
```
`cluster_id: null` + `duplicate_of` set (v1.2): AI dedup matched this to an earlier submission from the same phone/account — the complaint was still heard and processed, it just doesn't seed/join a new cluster.

## GET /api/submissions
Signed-in citizen's own complaints, newest first (backs the "My Complaints" page).
Auth required (401). Scoped by session user_id + RLS.
```json
{ "items": [ { "submission_id": "uuid", "ref": "8-char", "status": "processed", "channel": "text",
               "category": "drainage", "ward": "Ward 96 - ...", "severity": 4,
               "summary": "...", "submitted_at": "iso" } ] }
```
Twilio-side equivalent (no login): citizens text **STATUS** (or `STATUS <ref>`) to the
WhatsApp/SMS number — replies with their recent complaints, scoped by hashed sender ref.

## GET /api/submissions/:id
```json
{
  "submission_id": "uuid",
  "status": "received|transcribed|extracted|clustered|processed|failed",
  "channel": "voice",
  "lang": "te",
  "raw_text": "...",
  "transcript": "...",
  "extraction": {
    "category": "drainage",
    "ward": "Gajuwaka",
    "severity": 1-5,
    "summary_en": "...",
    "summary_original": "..."
  },
  "cluster_id": "uuid|null",
  "audit": [ { "stage": "extracted", "at": "iso", "model": "gemini-2.5-flash-002", "latency_ms": 840 } ],
  "failure_reason": "string|null",
  "resolution_status": "open|acknowledged|in_progress|resolved",
  "geo_verified": "boolean|null",
  "duplicate_of": "uuid|null"
}
```
`resolution_status` (v1.2): MP-workflow status, distinct from the pipeline `status` above. Defaults `"open"` once `status=processed`.
`geo_verified` (v1.2): photo submissions only. `true`/`false` if EXIF GPS present and checked against ward; `null` if no EXIF GPS (not penalized — common for screenshots/stripped images).
`duplicate_of` (v1.2): set when AI dedup matches this submission to an earlier one from the same phone.

## PATCH /api/submissions/:id/status
v1.2. Admin-only (401 without session, 403 non-admin). MP staffer updates resolution_status; triggers an SMS/WhatsApp to the citizen via Twilio if `phone` is on file.

Request:
```json
{ "resolution_status": "acknowledged|in_progress|resolved", "note": "string (optional, included in the SMS)" }
```
Response 200:
```json
{ "submission_id": "uuid", "resolution_status": "in_progress", "notified": true }
```
`notified: false` when no phone on file or the Twilio send failed — the status update itself always commits; notification failure is logged, never silent, and never blocks the status change.

## POST /api/verify/send
v1.2. Public. Sends an OTP via Twilio Verify.
Request: `{ "phone": "+91..." }` → Response 200: `{ "sent": true }`

## POST /api/verify/check
v1.2. Public. Verifies the OTP.
Request: `{ "phone": "+91...", "code": "123456" }` → Response 200: `{ "verified": true, "verify_token": "..." }`
`verify_token` is short-lived (15 min) and single-phone-scoped — pass it to POST /api/ingest's `verify_token` field.

## GET /api/rank?ward=&category=&lang=
MP dashboard ranked list.
```json
{
  "generated_at": "iso",
  "weights": { "frequency": 0.4, "severity": 0.25, "recency": 0.2, "demographic": 0.15 },
  "items": [
    {
      "cluster_id": "uuid",
      "rank": 1,
      "title_en": "Drainage overflow — Gajuwaka Sector 7",
      "category": "drainage",
      "ward": "Gajuwaka",
      "submission_count": 42,
      "score": 0.87,
      "score_breakdown": { "frequency": 0.92, "severity": 0.8, "recency": 0.85, "demographic": 0.9 },
      "first_seen": "iso",
      "last_seen": "iso",
      "sample_submission_ids": ["uuid", "uuid", "uuid"],
      "plan_match": { "doc_title": "GVMC Budget 2026-27", "snippet": "...", "relevance": 0.8 },
      "centroid": { "lat": 17.68, "lng": 83.19 }
    }
  ]
}
```
score_breakdown is mandatory — ranking-explanation panel depends on it.

## GET /api/heatmap?category=
```json
{ "points": [ { "lat": 17.68, "lng": 83.19, "weight": 3 } ] }
```

## GET /api/deadletters
Admin/audit view. USP surface.
```json
{ "items": [ { "submission_id": "uuid", "failed_stage": "extracted", "reason": "schema_validation_failed_after_retry", "raw_preview": "...", "at": "iso" } ] }
```

## GET /api/summary?ward=&category=
Admin-only (401/403 for non-admin, same gate as `/api/deadletters`). MP dashboard KPI/analytics
rollup — resolution totals, category/ward breakdown, 8-week resolved-vs-total trend. Scoped to
`status = 'processed'` submissions, same as `/api/rank` and `/api/heatmap`.
```json
{
  "generated_at": "iso",
  "totals": { "total": 824, "open": 292, "acknowledged": 126, "in_progress": 167, "resolved": 239 },
  "by_category": [ { "category": "garbage", "total": 177, "resolved": 56 } ],
  "by_ward": [ { "ward": "Ward 75 - Pedagantyada", "total": 69, "resolved": 20 } ],
  "trend": [ { "week": "iso (week start)", "total": 23, "resolved": 13 } ]
}
```
`by_ward` is top 8 by volume, not all wards. `trend` covers the last 8 calendar weeks only.

## GET /api/wards
```json
{ "wards": [ { "name": "Gajuwaka", "lat": 17.68, "lng": 83.19 } ] }
```

## GET /api/healthz (also /healthz)
200 `{ "db": "ok", "pubsub": "ok", "gemini": "ok" }` — each checked, not assumed; 503 if any fails.
Canonical path is **/api/healthz** — the bare `/healthz` is shadowed by the external HTTPS
load balancer and doesn't reach the app in prod. Point uptime checks at `/api/healthz`.

---

## Enums (closed lists, enforced in Gemini responseSchema)
- category: roads, drainage, water, health, education, garbage, streetlights, other
- ward: 98 official GVMC wards (final list in seed.sql, mirrored in /api/wards)
- status: received, transcribed, extracted, clustered, processed, failed
- resolution_status (v1.2): open, acknowledged, in_progress, resolved

## v1.2 additions (backend + frontend both, additive only)
- POST /api/ingest: optional phone, verify_token fields
- GET /api/submissions/:id: optional resolution_status, geo_verified, duplicate_of fields
- NEW: PATCH /api/submissions/:id/status (admin-only, feedback-loop trigger)
- NEW: POST /api/verify/send, POST /api/verify/check (Twilio OTP)
- Citizen trust score: internal only, NEVER exposed via any API response. Affects
  clustering/ranking eligibility server-side; does not add a 5th score_breakdown
  component (frontend's explanation panel is spec'd for exactly 4).
