-- db/rls_policies.sql — Row Level Security migration (task 11).
-- Apply AFTER db/seed.sql:  psql $DATABASE_URL -f db/rls_policies.sql
--
-- Session variables set per-transaction by the DAL (apps/web/lib/db.ts):
--   app.current_user_id   — Google account id from the NextAuth session
--   app.current_user_role — 'admin' (MP staff) | 'citizen'
--
-- IMPORTANT (enforcement scope): RLS does NOT apply to superusers or the table
-- owner (unless FORCE ROW LEVEL SECURITY). The worker connects as the owner and
-- bypasses RLS by design — the citizen-facing web app must connect as the
-- dedicated non-owner role below for the policies to bite. Cross-tenant leaks are
-- blocked at the DB even if an API route filter is missed.

-- Submissions need an owner column for the citizen policy. Backfilled rows and
-- worker-side inserts keep NULL (owned by no citizen — visible to admins only).
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;

-- Citizens: only their own submissions (empty/unset setting matches nothing).
CREATE POLICY citizen_access ON submissions FOR ALL USING (user_id = NULLIF(current_setting('app.current_user_id', true), ''));

-- MP Staff (Admins): everything.
CREATE POLICY admin_access ON submissions FOR ALL USING (current_setting('app.current_user_role', true) = 'admin');

-- Clusters carry no per-citizen data (aggregates only). RLS is enabled above, so
-- without a policy the default is deny-all for non-owner roles — which would kill
-- /api/rank and /api/heatmap for every authenticated user. Ranked aggregates are
-- readable by any authenticated principal; writes stay admin-only.
CREATE POLICY clusters_read ON clusters FOR SELECT USING (NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL OR current_setting('app.current_user_role', true) = 'admin');
CREATE POLICY clusters_admin_write ON clusters FOR ALL USING (current_setting('app.current_user_role', true) = 'admin');

-- Dedicated non-owner role for the web app (RLS enforced). Uncomment + set a real
-- password when wiring Cloud SQL; point the web app's DATABASE_URL at it. The
-- worker keeps the owner connection (bypasses RLS — it processes all rows).
-- CREATE ROLE jannaadi_web LOGIN PASSWORD '<from Secret Manager>';
-- GRANT USAGE ON SCHEMA public TO jannaadi_web;
-- GRANT SELECT, INSERT, UPDATE ON submissions, clusters TO jannaadi_web;
-- GRANT SELECT, INSERT ON audit_events, deadletters TO jannaadi_web;
-- GRANT SELECT ON wards, rank_weights, app_config TO jannaadi_web;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jannaadi_web;
