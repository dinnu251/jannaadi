-- db/trust_and_feedback.sql — v1.2 additions (feedback loop, OTP verification,
-- EXIF geofencing, trust scores, AI dedup). Additive only — no existing column
-- dropped/renamed/retyped. Apply after db/rls_policies.sql.
-- Run: psql $DATABASE_URL -f db/trust_and_feedback.sql

CREATE TYPE resolution_status_type AS ENUM ('open','acknowledged','in_progress','resolved');

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS phone             TEXT,               -- E.164, optional
  ADD COLUMN IF NOT EXISTS phone_verified    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolution_status resolution_status_type NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS geo_verified      BOOLEAN,            -- true/false/null(no EXIF GPS)
  ADD COLUMN IF NOT EXISTS duplicate_of      UUID REFERENCES submissions(id);

CREATE INDEX IF NOT EXISTS idx_submissions_phone ON submissions (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_duplicate_of ON submissions (duplicate_of) WHERE duplicate_of IS NOT NULL;

-- Hidden reputation signal, never exposed via any API response (PROMPTS.md task 15).
CREATE TABLE IF NOT EXISTS citizen_trust (
  phone       TEXT PRIMARY KEY,
  score       NUMERIC(5,2) NOT NULL DEFAULT 50.00,  -- 0-100, starts neutral
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: citizens' own resolution_status/phone visible via existing citizen_access
-- policy (no new policy needed — submissions RLS already covers new columns).
-- citizen_trust itself is server-only (owner-role reads); no policy needed since
-- the web app's jannaadi_web role is never granted access to this table:
-- (intentionally NOT in the jannaadi_web GRANT list in rls_policies.sql)
