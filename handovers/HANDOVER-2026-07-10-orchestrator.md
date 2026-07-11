# Orchestrator Handover — full-codebase sweep, session ending 10 Jul 2026 (~03:15 UTC)

Per COWORK.md the orchestrator owns commits; this session committed NOTHING. This report
maps the entire working tree so you can commit safely. Read with
`HANDOFF-2026-07-10-twilio-prod-pwa.md` (interface handoff) and `SECURITY.md`.

## 0. GIT STATE ANOMALY — resolve before committing
`git status` shows the ENTIRE previously-tracked tree staged as deleted (`D`) while every
file exists on disk as untracked. Someone appears to have run `git rm --cached -r .` (or
equivalent). Working tree is the single source of truth and is GOOD; the index is not.
Suggested reset: `git reset` (unstage the deletions) then stage fresh. Nothing on disk
was lost.

## 1. PRODUCTION STATE (all verified live at handover time)
- Cloud Run `jannaadi` rev **jannaadi-00050-rzw** serving 100%; `jannaadi-worker` idle
  (DEMO_MODE=true processes inline in web). `/api/healthz` = `{db,pubsub,gemini: ok}`.
- Public origin **https://app.prasyn.com** (global HTTPS LB `jannaadi-lb`, static IP
  8.233.135.102, managed cert ACTIVE; Squarespace A-record `app`). run.app URL also live.
- Twilio: WhatsApp sandbox (+14155238886, join **egg-flow**) + number **+1 531 331 4191**
  (voice+SMS) both webhooked to app.prasyn.com/api/twilio/*. Voice verified with a real
  Telugu call end-to-end.
- PWA installable; signed Android **APK/AAB at C:\Users\nagen\jannaadi-twa\** (OUTSIDE the
  repo, with keystore — pass `Jannaadi@2026`, SHA-256 fingerprint in memory + assetlinks).

## 2. NEVER COMMIT (verify .gitignore still covers before staging)
- `.env.local` (root) and `apps/web/.env.local` — LIVE SECRETS (Twilio token, DB
  passwords, Gemini key, OAuth secret). `frontend/.env` too.
- `gcp-credentials.json`, `logs/`, `node_modules/`, `frontend/dist`, `apps/web/.next*`
  (incl. any `.next-hung-*` leftovers).
- `data/wards_clean.json.bak` — restore backup for the geocode pass; keep local, don't ship.
- `.agents/` — orchestrator's own scratch; your call.
- Judgment calls: `frontend/src/pages/MapTestPage.tsx` + its `/map-test` route in App.tsx
  is a PUBLIC debug harness (synthetic data only) — deliberately kept for demo-day
  triage; remove post-event. `scripts/run-planmatch.ts` is a one-shot util worth keeping.

## 3. WHAT CHANGED THIS SESSION (by feature — all deployed & verified)

### A. Twilio multi-modal intake (docs/TWILIO.md)
- NEW `apps/web/lib/twilio.ts` (sig validation fail-closed in prod, media download,
  TwiML, senderRef HMAC, v1.2 OTP client), `lib/intake.ts` (single persist→process path,
  used by web ingest too), `lib/twilio-pending.ts` (ward-recovery conversation),
  `app/api/twilio/{sms,voice,voice/recording}/route.ts`.
- SMS route: STATUS / STATUS <ref> self-service tracking (sender_ref-scoped via
  `ownerDb()` — RLS-bypassing but self-scoping by construction, see lib/db.ts note).
- Recording route: RecordingSid idempotency (real Twilio retry double-ingested a call).
- worker/ingest.ts: ogg/amr STT + inline-MIME support.

### B. Auth / roles / citizen UX
- `AUTH_URL` + `ADMIN_EMAILS` were never set on Cloud Run → OAuth redirect went out as
  0.0.0.0:8080 (login broken) and everyone was role=citizen. Fixed as env; ALSO added
  pass-throughs in infra/deploy.sh (its --set-env-vars REPLACES the whole env set —
  without the pass-throughs a scripted deploy silently breaks login/roles/channels).
- NEW `GET /api/submissions` (session-scoped list) + `frontend/src/pages/MyComplaintsPage.tsx`;
  role-aware TopNav + Login pill + Logout chip (App.tsx); LoginPage lands by role;
  restyled Google-guideline button. i18n keys added (te/hi/en).
- v1.2 (PARALLEL session, live): OTP verify send/check routes, phone/phone_verified on
  ingest, PATCH /api/submissions/:id/status feedback loop, /api/summary, EXIF geofence,
  AI dedup (duplicate_of). Coordinate before touching SubmitPage.

### C. Dashboard (the big one — 9 stacked heatmap defects, all fixed)
See memory/`HANDOFF-…twilio-prod-pwa.md` for the full defect ledger. Headlines:
- `frontend/src/components/Heatmap.tsx`: visibility-deferred init (hidden tabs suspend
  rAF/RO/IO — Maps can't init), watchdog+retry+honest fallback with Retry button,
  renderingType-wait before deck overlay attach, **raster-first** (vector Map ID
  `4fac924d…` style-set 503s from gstatic — keyless URL, so NOT key/billing; re-enable
  vector only after publishing a style and retesting), weight cap 10, yellow→saffron→
  crimson ramp, fitBounds on filter change, mount/points diagnostics logs.
- DashboardPage: stable key="filters/kpis/body" (unkeyed index-matching REMOUNTED the
  map whenever the KPI strip appeared — do not remove these keys), SampleReport cards
  (real submission content + working audit-trail expansion; old link was dead),
  clickable By-Category/Top-Wards filter rows, title_localized preference.
- `/api/heatmap`: `ward` param (additive) + **3km own-ward-centroid geo gate**.
- `/api/rank`: additive `title_localized` (newest same-language member's summary_original).
- worker/planmatch.ts: sentence-boundary snippets ≤400 chars (was slice(0,200) mid-word).

### D. Geo data pipeline (scripts/ + data/)
- `scripts/geocode-wards.cjs` — 72/98 ward centroids corrected (report
  data/wards_geocoded.json; jurisdiction/plus-code/coarse guards).
- `scripts/build-pincode-map.cjs` → `pincode_wards` table (38 codes) + worker ladder
  rung: extraction → maps-grounding → **pincode** → citizen hint.
- `scripts/build-infra-anchors.cjs` (121 Places anchors: railway/substation/BSNL/
  APEPDCL — no open official APIs exist; Places is the sourced proxy) +
  `scripts/build-ward-geography.cjs` → data/ward_geography.json +
  **data/ward_boundaries.geojson** (51 hulls; approximate, NOT legal boundaries).

### E. Security / keys / PWA / health
- SECURITY.md (+ §10a code-sweep section from parallel session). Rate limiting
  (lib/ratelimit.ts), generic 500s, admin gate on /api/deadletters.
- Maps keys SPLIT + locked: browser key referrers = app.prasyn.com + run.app ONLY
  (localhost dropped — local-dev maps won't render; make a dev key if needed);
  server key = geocoding+places only, in env as GOOGLE_MAPS_SERVER_KEY.
- Health canonical at **/api/healthz** (bare /healthz is LB-shadowed); shared lib/health.ts;
  deploy.sh smoke updated.
- PWA: manifest/sw.js/icons/assetlinks in frontend/public (Vite DOES copy .well-known).

## 4. DATABASE MUTATIONS APPLIED (⚠ NOT reflected in db/seed.sql — schema drift!)
Applied directly to the live Cloud SQL DB this session/parallel:
1. `submissions.sender_ref TEXT` + partial index `idx_submissions_sender_ref`.
2. `submissions.phone`, `phone_verified` (+ v1.2 columns resolution_status/geo_verified/
   duplicate_of — verify parallel session's list).
3. NEW TABLE `pincode_wards(pincode PK, ward FK, lat, lng, post_offices)`.
4. wards.lat/lng updated for 72 wards (geocode pass).
5. All 800 synthetic submissions' lat/lng re-homed to ward-centroid±0.006 (seed data had
   random bbox coords — half the bbox is the Bay of Bengal; also killed stacked 2-dp
   coords incl. the 22-weight 17.8/83.2 bucket). One duplicate voice row deleted +
   cluster count decremented.
6. clusters.plan_match snippets regenerated (sentence-cut, local fallback path).
→ Recommend an orchestrator task: fold 1–3 into seed.sql (or a migrations dir) so a
fresh environment reproduces prod schema.

## 5. CLOUD/CONFIG MUTATIONS (not in code)
- Cloud Run env: AUTH_URL, ADMIN_EMAILS, TWILIO_ACCOUNT_SID, TWILIO_WEBHOOK_BASE_URL,
  TWILIO_WA_NUMBER/_JOIN_CODE, TWILIO_VOICE_NUMBER; secrets TWILIO_AUTH_TOKEN + rotated
  GOOGLE_MAPS_API_KEY (v7 = browser key, no trailing newline — earlier PowerShell-piped
  versions had CRLF).
- GCP: HTTPS proxy+forwarding rule on jannaadi-lb, managed cert jannaadi-app-cert,
  browser maps key created (c670ba53…), both keys restriction-tightened.
- Twilio: number PN045b… voice/sms URLs set via API; Verify service auto-provisions.

## 6. OPEN ITEMS (none demo-blocking)
1. OTP UI on SubmitPage (backend complete+tested; trial acct → OTP only to verified numbers).
2. Ward-boundary overlay on dashboard map (ward_boundaries.geojson ready).
3. Vector Map ID: publish a style in Cloud console, retest gstatic fetch, then flip
   Heatmap back to vector-first if desired.
4. seed.sql drift (see §4). 5. Remove /map-test post-event. 6. Play Store submission.
7. DEMO_MODE=false switch if long voice recordings must be bulletproof.
8. SECURITY.md §11 backlog (edge rate-limit, media magic-bytes, GCS retention, CSP tighten).

## 7. VERIFICATION LEDGER (how "done" was established)
Everything above was verified against LIVE prod, not just typechecks: signed/forged
Twilio webhooks (200/403), real Telugu phone call → processed row, STATUS reply, 401s,
OAuth redirect trace, browser-driven dashboard checks with console/log instrumentation
([Heatmap] logs remain in prod for future triage), screenshots. Both workspaces
`tsc --noEmit` clean at handover.
