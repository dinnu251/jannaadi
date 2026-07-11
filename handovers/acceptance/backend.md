# Backend Acceptance Criteria
Owner: Claude Code + gloop. Reviewer subagent verifies each item with evidence before status=pass.

## Pipeline correctness
- [ ] B1: Telugu voice sample → processed submission with correct category+ward → visible in /api/rank within 30s (DEMO_MODE)
- [ ] B2: 800 seed rows ingested → injected hotspots surface: 'Ward 75 - Pedagantyada' (Gajuwaka-area) drainage cluster in top-5 of /api/rank (ward names remapped to the official GVMC 98-ward list, 8 Jul decision)
- [ ] B3: Code-mixed (Tenglish) text input → correct extraction (golden set items G13–G15)
- [ ] B4: Photo + Telugu caption → category classified, ward from caption or citizen selection

## Reliability (USP: nothing lost, nothing silent)
- [ ] B5: Kill worker mid-batch → restart → zero lost submissions, no duplicates (idempotent processing)
- [ ] B6: Malformed Gemini response → 1 retry with error context → dead-letter on second failure → pipeline continues → row visible in /api/deadletters
- [ ] B7: STT confidence < threshold → fallback to Gemini multimodal direct path → still processes
- [ ] B8: Every processed submission has complete audit array (stage, timestamp, model version, latency)

## Ranking (USP: explainable)
- [ ] B9: Every /api/rank item includes score_breakdown; recomputing from weights table reproduces score
- [ ] B10: Changing a weight in config table → next /api/rank reflects it, no redeploy

## Gates
- [ ] B11: Golden test set 15/15 pass (run: ./scripts/golden.sh)
- [ ] B12: /healthz checks real dependencies (kill DB connection → db:"fail")
- [ ] B13: demo-reset.sh → row count 800, cluster count matches snapshot manifest

Evidence per item: test log path in backend-status.json. No log = fail.

## T1/T3 additions (contract-v1.1)
- [ ] B14: Landmark-only input, no ward hint ("pothole near RTC complex") → ward resolved via maps_grounding path, audit event records ward_resolved_via
- [ ] B15: Cluster matching a known plan item → plan_match populated with doc_title + snippet; Search outage → batch logs error, ingest unaffected
