# PROMPTS.md — Agent kickoff prompts

## Claude Code (backend, gloop-verified)

You are building the backend for JanNaadi, a civic-tech hackathon submission. Repo contains a frozen contract and skeleton — read these first, in order:
1. handovers/API.md — the API contract. FROZEN. Never modify. Frontend is built against it in parallel by another agent.
2. handovers/acceptance/backend.md — your definition of done. 15 criteria B1–B15 (B14 = Maps grounding, B15 = plan-match).
3. db/seed.sql, worker/ingest.ts, api/rank.sql, data/generate.ts — existing skeleton. Extend, don't rewrite.
4. docs/GOLDEN.md, docs/DEMO.md — test gates you must implement.

Your tasks, in dependency order:
1. Next.js 15 App Router project scaffold (apps/web), backend routes only: /api/ingest, /api/submissions/:id, /api/rank, /api/heatmap, /api/deadletters, /api/wards, /healthz — exact shapes per API.md.
2. /api/ingest: persist raw row status=received, upload media to GCS, publish {submission_id} to Pub/Sub topic 'submissions'. DEMO_MODE=true env → call processSubmission synchronously instead, return processed shape.
3. Wire worker/ingest.ts: swap inline validate() for zod schemas, add package.json deps, make REPLAY=true mode runnable.
4. /api/rank handler: execute api/rank.sql with ward/category params, assemble response per API.md including weights object and sample_submission_ids.
5. scripts/golden.sh + golden runner: 15 inputs per docs/GOLDEN.md, diff against expected, exit 0/1.
6. scripts/demo-reset.sh per docs/DEMO.md spec.
7. infra/deploy.sh: gcloud run deploy, asia-south1, env from Secret Manager.
8. T1 (already patched in worker/ingest.ts): verify Maps grounding path — landmark-only input resolves ward via resolveWardFromLatLng, audit records ward_resolved_via=maps_grounding (B14).
9. T3: wire worker/planmatch.ts — auth token acquisition, run after replay completes, apply the ALTER TABLE from seed.sql tail, pass plan_match through /api/rank handler when non-null and not {none:true} (B15). Requires PLAN_DATASTORE_ID env (human sets up datastore).

Security, Authentication, and RLS Tasks:
10. Auth.js v5 Integration (Google Cloud): Install next-auth@beta. Create auth.ts at the root and app/api/auth/[...nextauth]/route.ts. Configure it exclusively with the Google Provider (next-auth/providers/google) using GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the environment. Export auth, signIn, and signOut methods.
11. PostgreSQL RLS DB Migration: Create a new file db/rls_policies.sql. Write the SQL to:

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;

Create a policy for Citizens: CREATE POLICY citizen_access ON submissions FOR ALL USING (user_id = NULLIF(current_setting('app.current_user_id', true), ''));

Create a policy for MP Staff (Admins): CREATE POLICY admin_access ON submissions FOR ALL USING (current_setting('app.current_user_role', true) = 'admin');

The RLS Data Access Layer (DAL): Do not query the database directly in your route handlers. Create a wrapper function in your db client (e.g., lib/db.ts) that intercepts the current NextAuth session, extracts the Google user_id and assigned role, and wraps every database query in a transaction:

BEGIN;

SELECT set_config('app.current_user_id', $1, true);

SELECT set_config('app.current_user_role', $2, true);

[EXECUTE ACTUAL QUERY]

COMMIT;
Rule: This prevents cross-tenant data leaks and ensures the DB strictly enforces authorization, even if an API route filter is missed.

API Route Protection: Update /api/rank, /api/heatmap, and /api/submissions/:id to call await auth() at the very beginning. If no session exists, instantly return 401 Unauthorized.

Input Sanitization & Injection Prevention: Ensure every endpoint uses zod for strict type validation of the request body and query params. Use parameterized queries exclusively in api/rank.sql to prevent SQL injection.

Citizen Trust & Feedback Loop Tasks (contract-v1.2, additive — see handovers/API.md "v1.2 additions"):
12. Twilio Verify (OTP): POST /api/verify/send + POST /api/verify/check. Send/check via Twilio Verify API. On success, mint a short-lived (15 min) signed verify_token scoped to that phone (HMAC/JWT using AUTH_SECRET). /api/ingest accepts optional phone + verify_token — validates and sets phone_verified, but NEVER blocks a submission without them (open civic intake is a hard requirement).
13. Feedback loop: PATCH /api/submissions/:id/status (admin-only — 401/403 per the existing auth pattern). Updates resolution_status (open|acknowledged|in_progress|resolved). If the submission has a phone on file, send an SMS/WhatsApp via Twilio with the new status + optional note. The status update always commits even if the Twilio send fails — log the failure loudly, return notified:false, never roll back the status change on a notification error.
14. EXIF geofencing: on photo submissions, parse EXIF GPS + DateTimeOriginal from the uploaded image. Compare GPS to the resolved ward's centroid (reuse the haversine in resolveWardFromLatLng). Set geo_verified=true/false when EXIF GPS is present; leave null (not penalized) when absent — many phones/apps strip EXIF. Write an audit_event with the check detail.
15. Citizen trust score: new citizen_trust table keyed by phone. Adjust on phone_verified, geo_verified match, dead-lettered/failed submissions, flagged duplicates. Internal only — never expose via any API response. Use it server-side to gate which submissions count toward a cluster's frequency component in rank.sql, rather than adding a visible 5th score_breakdown dimension (the frontend's explanation panel is spec'd for exactly 4 components — do not change that shape).
16. AI dedup: detect near-identical raw_text (or high embedding similarity) from the same phone within a short window during cluster assignment; mark duplicate_of on the later submission instead of letting it seed/join a cluster normally.

Rules:
- No silent failures anywhere. Every catch writes deadletters or rethrows loudly.
- Every pipeline stage writes audit_events.
- Idempotency: FOR UPDATE SKIP LOCKED pattern already in worker — preserve it in anything you add.
- After each task: run relevant acceptance criteria, write handovers/backend-status.json per schema {task, status: pass|fail|blocked, criteria_met[], criteria_failed[], evidence, timestamp}. Evidence = test log path. No log = fail.
- Verification loop: after implementing, independently verify end-to-end before marking pass. B1 is the master check: Telugu voice sample through /api/ingest → appears in /api/rank within 30s in DEMO_MODE.
- Model pin: gemini-2.5-flash-002 style versioned string from app_config, never 'latest'.
- Do not touch frontend files or handovers/frontend-status.json.
- Never run git commands — commits, tags, and pushes are owned by the Cowork orchestrator.

Exit criteria: backend.md B1–B15 all pass with evidence, tasks 12-16 (v1.2) verified with evidence, deployed to Cloud Run, /healthz green.

---

## Google Antigravity (frontend + scrape + deploy verification)

You are building the frontend for JanNaadi, a civic-tech hackathon submission (Track 1: citizens submit development requests by voice/text/photo in Telugu/Hindi/English; MP dashboard shows AI-ranked priorities). Read first:
1. handovers/API.md — the API contract. FROZEN. Build against these exact shapes. Backend is built in parallel by another agent — mock responses from API.md examples until backend-status.json shows pass on the endpoint you need.
2. handovers/acceptance/frontend.md — your definition of done. 15 criteria F1–F15 (F14 = plan-match badge, F15 = auth/login).
3. docs/DECK.md — palette and design language.

Task 0 (do first, standalone): Playwright headless session → scrape official GVMC ward list from gvmc.gov.in (or Wikipedia GVMC wards page as fallback). Output data/gvmc_wards.json: [{name, approx_lat, approx_lng}]. Pick 12 wards matching or replacing the placeholder list in db/seed.sql. Write the replacement INSERT block to data/wards_real.sql. Do NOT edit seed.sql directly — human swaps both files together.

Frontend tasks:
1. Citizen submit page (mobile-first, 390px baseline): text input, voice record + voice file upload, photo upload with caption, ward selector from /api/wards, language toggle te/hi/en via i18n file. Submission → confirmation with submission_id → status polling.
2. MP dashboard: ranked priority list from /api/rank with ward/category/lang filters; click item → score_breakdown explanation panel visualizing the four weighted components; audit trail view per submission; Google Maps heatmap from /api/heatmap with category filter and static-image fallback on Maps failure.
3. Dead-letter admin page from /api/deadletters.
4. Cached-response fallback: any Gemini-dependent call >5s → cached demo response, subtle 'cached' badge.
5. T3 (F14): "In dev plan" badge — saffron #E8871E — on ranked items where /api/rank returns plan_match (non-null, not {none:true}); snippet in tooltip/tap. Render nothing when absent — field is optional.

Security, Authentication, and UI Tasks:
8. Authentication UI: Build a clean, mobile-first Login Page (/login) following the design palette. Integrate the Auth.js signIn('google') server action via a prominent "Sign in with Google" button.
9. Client-Side Route Guard & Vite Proxy: Set up a Vite proxy in vite.config.ts to route /api/* to the backend. Use a React Router <Navigate> client-side guard to protect the MP Dashboard (/dashboard or similar routes)—do not use middleware.ts. If a user attempts to route to the dashboard without a valid session, redirect them to /login.
10. Session Provider & Context: Use next-auth/react with explicit basePath and wrap the root application in a SessionProvider so client components can seamlessly access useSession() for rendering conditional UI.
11. Secure Data Fetching: When calling /api/rank or /api/heatmap, gracefully handle 401 or 403 HTTP status codes. If a 401 is returned, trigger an automatic redirect to the login screen.
12. XSS Protection: For the Citizen Submit page and Dashboard Audit trail, ensure any raw text rendered from the database (e.g., grievance descriptions, voice transcripts) is safely escaped. Do not use dangerouslySetInnerHTML unless passed through a strict DOM sanitizer like DOMPurify.

Design rules (F12):
- Palette: deep teal #0F5257 primary, warm sand #F4EDE4 neutrals, saffron #E8871E for rank/severity signals, red #C0392B ONLY for dead-letters. No default Tailwind blue/indigo anywhere.
- Contrast AA on mobile. Non-technical legibility: an MP staffer must understand the dashboard without explanation.
- Auth States: The UI must visually indicate the user's role (Citizen vs. MP Staff) and ideally display their Google avatar/name. Include a subtle, accessible 'Logout' button in the header using the warm sand #F4EDE4 color.
- Forbidden States: If RLS blocks a query and returns empty or unauthorized, show an elegant "Access Restricted" empty state using the #C0392B red palette as an accent, rather than breaking the application with an unhandled exception.

Rules:
- After each task: screenshot/recording artifact, write handovers/frontend-status.json {task, status, criteria_met[], criteria_failed[], evidence, timestamp}. Evidence = artifact path.
- Do not touch worker/, api/, db/, scripts/ or backend-status.json.
- Never run git commands — commits, tags, and pushes are owned by the Cowork orchestrator.
- Verify F11 (dashboard <2s) against the DEPLOYED URL, not localhost, once backend deploy lands.

Exit criteria: frontend.md F1–F15 pass with artifacts.
