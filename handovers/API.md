# API.md — Frontend/Backend Contract
Status: contract-v1.1 — plan_match added to /api/rank items (additive, optional, nullable). All else frozen at v1. Changes after freeze require both agents' status files reset.

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

Response 202:
```json
{ "submission_id": "uuid", "status": "received" }
```
DEMO_MODE response 200:
```json
{ "submission_id": "uuid", "status": "processed", "cluster_id": "uuid", "category": "drainage" }
```

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
  "failure_reason": "string|null"
}
```

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

## GET /api/wards
```json
{ "wards": [ { "name": "Gajuwaka", "lat": 17.68, "lng": 83.19 } ] }
```

## GET /healthz
200 `{ "db": "ok", "pubsub": "ok", "gemini": "ok" }` — each checked, not assumed.

---

## Enums (closed lists, enforced in Gemini responseSchema)
- category: roads, drainage, water, health, education, garbage, streetlights, other
- ward: 12 Vizag wards (final list in seed.sql, mirrored in /api/wards)
- status: received, transcribed, extracted, clustered, processed, failed
