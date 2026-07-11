# DEMO.md

## Pre-demo checklist (T-30 min)
- [ ] ./scripts/demo-reset.sh → exit 0
- [ ] curl /api/healthz → all "ok" (bare /healthz is shadowed by the external LB on the default *.run.app domain — see docs/TWILIO.md sibling note in SECURITY.md / handovers/API.md)
- [ ] ./scripts/golden.sh → 15/15
- [ ] Warm cache: replay 20 demo inputs
- [ ] Cloud Run min-instances=1 confirmed (set 14 July)
- [ ] Heatmap visual check on deployed URL
- [ ] Demo API key active, build key disabled
- [ ] Phone hotspot tested (Delhi only)

## Golden path (3 min, scripted, no improvisation)
1. Upload Telugu voice file G04 (PHC, Pendurthi)
2. Status: received → processed on screen (<30s, DEMO_MODE sync)
3. Dashboard: item ranked, cluster count +1
4. Click item → score_breakdown panel ("here's WHY it ranks #3")
5. Heatmap → Pedagantyada (Gajuwaka-area, Ward 75) hotspot zoom
6. Dead-letter page ("what the AI couldn't process — nothing silent")

Steps 4 and 6 are the USP beats. Never cut them for time; cut step 5 if squeezed.

## Fallback ladder
Live call → cached response (>5s timeout) → recorded video → deck screenshots

## demo-reset.sh spec
1. Truncate submissions, clusters, deadletters
2. pg_restore demo_seed.dump (800 rows, embeddings frozen, clusters pre-assigned)
3. Purge Pub/Sub subscription backlog
4. Set DEMO_MODE=true
5. Assert: submissions==800, clusters==manifest count, /api/rank top-1 == expected cluster_id
6. Exit 1 loudly on any assert fail

## Recording (Day 2 PM, 8 July)
- 3-min video = golden path exactly, deployed URL visible in browser bar
- Record only after golden.sh 15/15 and reset
- Screen + voiceover; Telugu audio audible in step 1
