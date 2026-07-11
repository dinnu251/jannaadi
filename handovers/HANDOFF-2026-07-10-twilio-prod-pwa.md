# Handoff — Twilio capture, production deploy, domain, PWA/APK (session ending 10 Jul 2026)

For the next session refining the interface. Everything below is **deployed and verified live**
unless marked otherwise. Read alongside `handovers/API.md` (contract) and `SECURITY.md`.

## 1. Where the app runs (use these, not localhost)

| Surface | URL |
|---|---|
| **Production (canonical)** | `https://app.prasyn.com` |
| Direct Cloud Run | `https://jannaadi-gyt7cqh47q-el.a.run.app` |
| Health (canonical) | `GET /api/healthz` → `{"db":"ok","pubsub":"ok","gemini":"ok"}` 200/503 |

- Web service `jannaadi` (rev ~00009+) + `jannaadi-worker`, asia-south1, project `jannaadi`.
- Fronted by a **global external HTTPS LB** (`jannaadi-lb`) on reserved IP `8.233.135.102`;
  Squarespace DNS A record `app` → that IP; Google-managed cert ACTIVE.
- **LB gotcha:** bare `/healthz` is the LB's reserved health path → Google 404, never reaches
  the app. Health logic lives in `apps/web/lib/health.ts`, exposed at BOTH `/healthz` (local
  only) and **`/api/healthz`** (canonical). Point anything health-related at `/api/healthz`.
- `DEMO_MODE=true` on the web service → submissions process **synchronously inline** (no
  Pub/Sub hop); `/api/ingest` returns the full processed result in one call (~3–10s).
- Redeploy (preserves all env/secrets/config): `gcloud run deploy jannaadi --source . --region asia-south1 --project jannaadi --quiet`.
  Cloud Build runs `npm ci` — any new dep MUST be in package.json AND package-lock.json.

## 2. API changes the interface should know about

- **`POST /api/ingest` response now includes `ward`** (additive to contract v1.1):
  `{ submission_id, status:"processed", cluster_id, category, ward }` — the resolved ward
  name (e.g. `"Ward 19 - MVP Sector-12"`). Show it in the confirmation UI.
- Error envelope unchanged: `{ "error": { "code", "message" } }`. New code: `429 rate_limited`
  (per-IP 30/min on `/api/ingest`). 500s now return a **generic** message (no internals).
- **v1.2 fields on `/api/ingest`** (added by a parallel session, live): optional `phone`
  (E.164, `^\+[1-9]\d{6,14}$`) + `verify_token` (from the OTP flow). Phone is stored only if
  the token proves OTP passed; never blocks submission. `submissions` table now has
  `phone`, `phone_verified` columns.
- `GET /api/deadletters` is now **admin-only** (401/403) — was open. Interface must handle 403.
- `/api/config` unchanged (serves `mapsApiKey`).
- Security headers are set globally (CSP allows self + Google Maps/fonts origins). If you add
  external scripts/assets to the frontend, the CSP in `apps/web/next.config.ts` must be updated
  or they will be blocked.

## 3. Twilio multi-modal capture (SMS / WhatsApp / voice calls)

Citizens file complaints without the app; all channels reuse the exact same pipeline via
`apps/web/lib/intake.ts` → `persistAndProcess()` (single persist→audit→process path — the web
`/api/ingest` route uses it too; don't bypass it).

| Route | Twilio config | Notes |
|---|---|---|
| `POST /api/twilio/sms` | WhatsApp sandbox + SMS "message comes in" (SET, live) | text→text, image→photo (body=caption), audio→voice |
| `POST /api/twilio/voice` | Voice "call comes in" | returns `<Record>` TwiML (60s) |
| `POST /api/twilio/voice/recording` | set automatically | ingests recording as voice |

- Security boundary = `X-Twilio-Signature` HMAC (in `apps/web/lib/twilio.ts`). **Fails closed in
  prod** if `TWILIO_AUTH_TOKEN` unset. `TWILIO_WEBHOOK_BASE_URL=https://app.prasyn.com` is
  pinned on the service — if the domain ever changes, update it or all webhooks 403.
- Phone numbers are never stored from Twilio: provenance = HMAC `senderRef` + `source` tag
  (`twilio-sms|twilio-whatsapp|twilio-voice`) in `audit_events.detail`.
- **Conversational ward recovery:** if ward can't be resolved, the bot replies asking for the
  locality and stashes the complaint (in-memory, 10-min TTL, `lib/twilio-pending.ts`); the
  sender's next text is threaded as `Location: <reply>. Complaint: <original>`. NOTE: in-memory
  = single-instance only; a DB-backed `awaiting_location` status is the prod-grade upgrade.
- Confirmation reply format: `✓ Complaint registered: <category> in <ward>. Ref: <8-char id>.`
- Per-sender rate limit 12/min (friendly TwiML, not 429 — a non-200 makes Twilio retry).

## 4. Ward resolution / data

- Ward data = **centroids only, no polygons**. `resolveWardFromLatLng` (worker) snaps Maps-
  grounded coords to nearest centroid ≤4km.
- Ran `scripts/geocode-wards.cjs` (Geocoding API): **72/98 centroids corrected** (many were
  10–27km off), 26 kept old (rejected as city-fallback/plus-code/other-jurisdiction). Report:
  `data/wards_geocoded.json`; backup: `data/wards_clean.json.bak`. Re-run with `--dry-run` first.
- Still heuristic. Exact accuracy needs GVMC ward polygons + point-in-polygon (in-process in
  the worker; no PostGIS in the pgvector image). Maps Datasets API ≠ a PIP resolver.
- Worker also gained (parallel session, v1.2): EXIF GPS geofence for photos (`exifr`), and
  `.ogg`/`.amr` STT + Gemini-inline MIME support (Twilio voice notes).

## 5. Frontend / PWA / Android

- Citizen frontend = Vite+React SPA in `frontend/`, served same-origin by the Next app
  (fallback rewrite). **No Flutter/native code exists.**
- **PWA live**: `frontend/public/manifest.webmanifest`, `sw.js` (network-first; never caches
  POST or `/api/*`), icons `icon-192/512/maskable-512/apple-touch-icon.png` (generated from
  `favicon.svg` via sharp), wiring in `frontend/index.html` (manifest link, theme `#863bff`,
  SW registration). Chrome Android shows "Install app" on `app.prasyn.com`.
  - If you touch `index.html` or rename assets, keep the manifest/SW/icon links intact.
  - SW is `jannaadi-v1` cache — bump the cache name if you need to force-refresh clients.
- **Signed Android artifacts built** (TWA wrapper of app.prasyn.com, package `com.prasyn.jannaadi`):
  - `C:\Users\nagen\jannaadi-twa\JanNaadi-v1.0.apk` (1.26MB, sideloadable now)
  - `C:\Users\nagen\jannaadi-twa\JanNaadi-v1.0.aab` (1.37MB, Play Store)
  - Keystore `C:\Users\nagen\jannaadi-twa\android.keystore` — pass `Jannaadi@2026`, alias
    `jannaadi`, SHA-256 `9A:41:E3:46:05:4E:EF:5B:74:36:3F:26:81:8D:5B:BC:C1:ED:70:B4:66:12:77:22:96:EA:87:EC:35:F8:09:BD`.
    **Do not lose/regenerate** — it's the permanent app identity.
  - Toolchain: JDK17 `C:\Users\nagen\jannaadi-android-tools\jdk\jdk-17.0.19+10`, SDK `C:\Users\nagen\asdk`.
    `bubblewrap build` is broken on this machine — build with `.\gradlew.bat assembleRelease|bundleRelease`
    in `C:\Users\nagen\jannaadi-twa`, then zipalign+apksigner (APK) / jarsigner (AAB).

## 6. OPEN ITEMS (in priority order)

1. ~~assetlinks.json~~ **RESOLVED**: live on rev `jannaadi-00016` —
   `https://app.prasyn.com/.well-known/assetlinks.json` returns the JSON
   (`application/json`, package `com.prasyn.jannaadi` + keystore SHA-256). The APK renders
   full-screen (no URL bar). Vite DOES copy `.well-known` from `frontend/public/`.
2. **Web push/OTP UI (v1.2)**: backend accepts `phone`+`verify_token`; interface work for the
   OTP flow may still be in flight from the parallel session — coordinate before changing
   `SubmitPage`.
3. `DEMO_MODE=false` switch if long phone-call recordings must be robust (>15s Twilio timeout);
   trade-off: replies say "received" instead of the category.
4. Ward polygons for exact resolution; edge rate-limiting; GCS media retention; CSP tightening
   (`unsafe-inline`/`unsafe-eval` still allowed for the SPA); split Maps browser/server keys.
5. Play Store publish: needs Play Console account ($25) + add Google Play App Signing SHA-256
   to assetlinks.

## 7. Machine/session gotchas (save yourself an hour)

- Next loads `apps/web/.env.local`, NOT the repo-root `.env.local` (keep both in sync;
  `GOOGLE_APPLICATION_CREDENTIALS` must be an absolute path in the apps/web copy).
- Zombie node processes lock `.next` and hang both dev and build — kill stale
  `standalone/apps/web/server.js` + old `next` procs, clear `.next`, restart.
- Local DB = Cloud SQL Auth Proxy on 127.0.0.1:5433 (`C:\Users\nagen\cloud-sql-proxy.exe.exe jannaadi:asia-south1:jannaadi-db --port=5433`).
- Local tunnels are obsolete for the demo (prod domain supersedes); ngrok is Defender-blocked.
- Git: the Cowork orchestrator owns commits (COWORK.md) — this session committed nothing.
