# JanNaadi — Security Policy

JanNaadi is a civic-complaint platform for Visakhapatnam: citizens submit grievances
(web, SMS, WhatsApp, phone), an AI pipeline extracts and clusters them, and MP staff
review them on a dashboard. It handles citizen-submitted content and limited PII, so the
controls below are enforced in code and required in every deployment.

## 1. Reporting a vulnerability

Email **security@jannaadi** (or the maintainers) with steps to reproduce. Do not open a
public issue for undisclosed vulnerabilities. We aim to acknowledge within 72h.

## 2. Authentication & authorization

- **Identity:** Auth.js v5, Google OAuth only ([apps/web/auth.ts](apps/web/auth.ts)). JWT sessions.
- **Roles:** emails in `ADMIN_EMAILS` → `admin` (MP staff); everyone else → `citizen`.
- **Route protection:**
  - `/api/rank`, `/api/heatmap`, `/api/submissions/:id` — require an authenticated session (401 otherwise).
  - `/api/deadletters`, `/api/summary` — **admin only** (401/403); expose raw complaint previews /
    cross-citizen aggregate counts respectively.
  - `/api/ingest`, `/api/twilio/*` — intentionally public (see §3).
- **Database RLS is the backstop, not the only gate.** Web requests connect as the
  non-owner `jannaadi_web` role via `WEB_DATABASE_URL`; policies in
  [db/rls_policies.sql](db/rls_policies.sql) restrict rows by `app.current_user_id` /
  `app.current_user_role`, set per-transaction in the DAL ([apps/web/lib/db.ts](apps/web/lib/db.ts)).
  Sensitive routes ALSO check the role explicitly, so a misconfiguration (e.g. falling
  back to the owner connection) cannot silently expose data.
  - **Production MUST run the web app as `jannaadi_web`** (never the owner). The worker
    uses the owner connection by design (processes all rows) and must not be internet-facing.

## 3. Public endpoints & abuse controls

These are reachable without a session and incur cost (Gemini / Speech-to-Text / GCS):

- **Twilio webhooks** (`/api/twilio/sms`, `/api/twilio/voice`, `/api/twilio/voice/recording`):
  every request is validated against `X-Twilio-Signature` (HMAC-SHA1 over the signed URL +
  sorted params, keyed by `TWILIO_AUTH_TOKEN`) in [apps/web/lib/twilio.ts](apps/web/lib/twilio.ts).
  Invalid/missing signature → 403. **In production, a missing `TWILIO_AUTH_TOKEN` fails
  closed** (403), never skips validation. Signature confirms origin, not content safety.
- **Rate limiting** ([apps/web/lib/ratelimit.ts](apps/web/lib/ratelimit.ts)): per-IP on
  `/api/ingest` (30/min), per-sender on Twilio (12/min). This is a best-effort,
  per-instance defence-in-depth layer — **production must also rate-limit at the edge**
  (Cloud Armor / API Gateway / a shared Redis or Firestore counter). Disable locally with
  `RATE_LIMIT_DISABLED=true`.
- **Media size/type limits:** images ≤5MB (jpg/png), audio ≤15MB (webm/wav/mp3/ogg/amr).
  Content-types are client-declared; media is only stored in GCS and passed to STT/Gemini
  — never executed or served back inline. Magic-byte sniffing is a recommended addition.

## 4. Secrets & credentials

- **Never commit secrets.** `.env*`, `gcp-credentials.json`, `*credentials*.json`, and
  `logs/` are gitignored; verified untracked. `apps/web/.env.local` (local dev) is also ignored.
- **Production secrets live in Secret Manager**, injected at deploy
  ([infra/deploy.sh](infra/deploy.sh)): `GEMINI_API_KEY`, `DATABASE_URL`,
  `WEB_DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_MAPS_API_KEY`,
  `TWILIO_AUTH_TOKEN`. No secret is baked into an image or the frontend bundle.
- **Rotation:** rotate `TWILIO_AUTH_TOKEN`, `GEMINI_API_KEY`, DB passwords, and
  `AUTH_SECRET` on any suspected exposure or staff offboarding. Rotating `AUTH_SECRET`
  invalidates all sessions (intended).
- **Least privilege:** the Cloud Run runtime service account gets only Secret Manager
  accessor, Cloud SQL Client, the media bucket's object role, and Pub/Sub — nothing more.

## 5. API-key restrictions (Google Maps)

`GOOGLE_MAPS_API_KEY` is served to the browser via `/api/config` (unavoidable for the
Maps JS SDK). It **must be restricted** in the GCP console:
- **Application restriction:** HTTP referrers = your Cloud Run / production domain only.
- **API restriction:** only the Maps/Places/Geocoding APIs actually used.
- **Server-side calls** (e.g. [scripts/geocode-wards.cjs](scripts/geocode-wards.cjs)) should
  use a **separate** key restricted by IP (or a service account), so the browser key can
  stay referrer-locked. Do not ship one unrestricted key.

## 6. Data protection & PII

- **Phone numbers are never stored.** Twilio provenance is a non-reversible HMAC
  (`senderRef`, keyed by `AUTH_SECRET`) written only to `audit_events.detail`, alongside a
  `source` tag. See [apps/web/lib/twilio.ts](apps/web/lib/twilio.ts).
- **Complaint content** (text, photos, audio) may contain PII. Media is stored in a
  private GCS bucket (no public ACLs); access is via authenticated service-account reads
  only. Define and enforce a **retention policy** (e.g. auto-delete raw media after N days;
  keep only derived summaries/embeddings) via a GCS lifecycle rule.
- **In transit:** all traffic is HTTPS (Cloud Run + the tunnel/edge terminate TLS; HSTS set).

## 7. Untrusted input & LLM safety

- Citizen text/media is **untrusted input** and reaches Gemini only as user content — the
  extraction prompt is fixed and never concatenates message text into instructions.
- **Output is constrained**, not free-form: Gemini responds under a JSON schema with
  **closed enums** for category/ward/lang, and every field is re-validated with zod against
  the live ward list ([worker/ingest.ts](worker/ingest.ts)). A model can't invent a ward or
  category, which blunts prompt-injection impact.
- All request bodies are zod-validated at the boundary; failures return shaped 400s.

## 8. Transport & browser hardening

Security headers are set for every route in [apps/web/next.config.ts](apps/web/next.config.ts):
`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and a
`Content-Security-Policy` scoped to self + the Google Maps origins. `X-Powered-By` is
disabled. Tighten the CSP (drop `unsafe-inline`/`unsafe-eval`) if/when the SPA build allows.

## 9. Error handling, logging & audit

- **No internal disclosure:** unhandled errors log full detail server-side but return a
  generic message to the client ([apps/web/lib/api.ts](apps/web/lib/api.ts)).
- **Audit trail:** every pipeline stage writes `audit_events`; every failure writes
  `deadletters` — nothing is silent. These are admin-only surfaces (§2).

## 10. Dependencies & supply chain

- Pin and review dependencies; run `npm audit` in CI and patch high/critical promptly.
- The AI model version is **pinned** (`app_config.gemini_model`); the worker refuses to run
  on a `latest`/unpinned model.

## 10a. Code sweep findings (10 July) — fixed

A full codebase review (backend + frontend) found and fixed six real bugs, verified
against the live deployed app, not just statically:

1. **`frontend/src/api.ts`**: the "cached fallback" (meant only for a slow Gemini call,
   per the original spec) fired on *any* non-2xx response or exception — a real
   validation error, rate limit, or server crash silently returned fake success data.
   A citizen's rejected complaint would show a fake "processed" confirmation and never
   actually be recorded. Rewritten with a real timeout (`AbortController`, 8s) as the
   only trigger for the mock fallback; genuine errors now surface as `res.error`.
2. **`SubmitPage.tsx`**: `isSubmitting` was never reset on a rejected/failed
   submission — the button got stuck on "Submitting…" with no explanation and no way
   to retry. Fixed with a `finally` block and a visible error message.
3. **`DashboardPage.tsx`**: the category filter was missing 2 of the backend's 8 valid
   categories (`education`, `other`) — unreachable from the UI despite being valid.
4. **`DashboardPage.tsx` / `DeadLettersPage.tsx`**: a real fetch failure (e.g. a 403 for
   a non-admin visiting dead-letters) showed stale/empty data with no indication
   anything was wrong; both now show a visible error state.
5. **`Heatmap.tsx`**: `@googlemaps/js-api-loader` v2 removed the `Loader` class
   constructor (it now throws at construction time) in favour of standalone
   `setOptions()`/`importLibrary()` functions. The old `new Loader(...)` call threw
   *outside* the component's try/catch, so the heatmap was permanently blank in
   production with **no error surfaced and no static fallback shown either** — this
   bug was invisible to static code review and only surfaced live, via the browser
   console, during a demo recording. Fixed using the current functional API with the
   whole init now inside the try/catch, so a real failure correctly falls back to the
   static hotspot overview.
5a. **`Heatmap.tsx` (found re-verifying fix #5, live)**: a second, unrelated issue —
   Google has fully **removed** the classic `google.maps.visualization.HeatmapLayer`
   class from the Maps JS API as of v3.65 ("no longer available," not just
   deprecated). Since the app loads `v: "weekly"`, `new HeatmapLayer(...)` now throws
   on every load. That call lived in a *second* `useEffect` with no try/catch at all,
   so the uncaught exception blanked the **entire dashboard route**, not just the map
   widget — worse than bug #5. Fixed by wrapping that effect in try/catch, falling
   back to the static hotspot overview. This is a **standing gap, not a one-time
   fix**: the heatmap will now always render the static fallback until it's
   reimplemented on a non-deprecated renderer (e.g. a WebGL/canvas heat layer or a
   third-party viz library) — tracked in §11 hardening backlog.
5b. **`index.css` / `App.tsx` (found re-verifying fix #5a, live)**: `#root` used
   `min-height: 100vh` instead of `height: 100vh`. `min-height` doesn't give
   descendants a *definite* height to resolve `height: 100%` against, so panes meant
   to scroll internally (the dashboard's ranked-priority list) instead grew `#root`
   to their full content height — 6834px tall against a 730px viewport, confirmed
   live via `getBoundingClientRect()`. Every sibling column stretched to match,
   pushing the heatmap panel (and its fallback text) roughly 3450px below the fold —
   it looked blank because it was rendered off-screen, not because it failed. Fixed
   by giving `#root` a real `height: 100vh` and moving the scroll boundary to
   `<main>` (`overflow-y: auto`, `min-height: 0`) so plain content pages (submit,
   login, dead-letters) keep scrolling normally; `DashboardPage`'s own root already
   sets `overflow: hidden` and opts out in favour of its per-column internal scroll.
   Verified live: `#root` now measures exactly the viewport height and the heatmap
   fallback renders in-view.
6. **`worker/planmatch.ts`** (found during v1.2 verification, documented in
   `handovers/backend-status.json`): pgvector running-mean centroid math and Twilio
   trial-account/IAM issues — see that file for the full list.

## 11. Known gaps / hardening backlog

1. Rate limiting is per-instance/in-memory — add an **edge/shared-store limit** for prod.
2. **Split the Maps key** (referrer-locked browser key vs IP-locked server key).
3. Add **magic-byte validation** for uploaded media (don't trust declared content-type).
4. Add a **GCS lifecycle/retention** rule for raw media.
5. Tighten **CSP** to remove `unsafe-inline`/`unsafe-eval` once the SPA supports nonces/hashes.
6. Consider whether `/api/rank` and `/api/heatmap` should be **admin-only** (currently any
   authenticated user) per the MP-dashboard intent.
7. Enable **`npm audit` / dependency scanning** and secret-scanning in CI.
8. **Reimplement the live heatmap layer** — `google.maps.visualization.HeatmapLayer`
   is fully removed from the Maps JS API; `Heatmap.tsx` now always shows the static
   fallback (see §10a #5a). Needs a replacement renderer.
