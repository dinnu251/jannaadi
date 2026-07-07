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

Rules:
- No silent failures anywhere. Every catch writes deadletters or rethrows loudly.
- Every pipeline stage writes audit_events.
- Idempotency: FOR UPDATE SKIP LOCKED pattern already in worker — preserve it in anything you add.
- After each task: run relevant acceptance criteria, write handovers/backend-status.json per schema {task, status: pass|fail|blocked, criteria_met[], criteria_failed[], evidence, timestamp}. Evidence = test log path. No log = fail.
- Verification loop: after implementing, independently verify end-to-end before marking pass. B1 is the master check: Telugu voice sample through /api/ingest → appears in /api/rank within 30s in DEMO_MODE.
- Model pin: gemini-2.5-flash-002 style versioned string from app_config, never 'latest'.
- Do not touch frontend files or handovers/frontend-status.json.
- Never run git commands — commits, tags, and pushes are owned by the Cowork orchestrator.

Exit criteria: backend.md B1–B15 all pass with evidence, deployed to Cloud Run, /healthz green.

---

## Google Antigravity (frontend + scrape + deploy verification)

You are building the frontend for JanNaadi, a civic-tech hackathon submission (Track 1: citizens submit development requests by voice/text/photo in Telugu/Hindi/English; MP dashboard shows AI-ranked priorities). Read first:
1. handovers