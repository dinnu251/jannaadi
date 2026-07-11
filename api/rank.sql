-- api/rank.sql — JanNaadi ranking query (B9, B10)
-- Each component normalized 0–1 in-query. Weights read live from rank_weights (no redeploy).
-- Returns score_breakdown columns for the MP explanation panel.

WITH w AS (
  SELECT
    MAX(CASE WHEN key='frequency'   THEN weight END) AS w_freq,
    MAX(CASE WHEN key='severity'    THEN weight END) AS w_sev,
    MAX(CASE WHEN key='recency'     THEN weight END) AS w_rec,
    MAX(CASE WHEN key='demographic' THEN weight END) AS w_demo
  FROM rank_weights
),
cfg AS (
  SELECT (SELECT val::float FROM app_config WHERE key='recency_half_life_days') AS half_life
),
stats AS (
  -- per-cluster aggregates from processed submissions
  -- trusted_count (task 15): submission_count filtered to phones with no confirmed
  -- low trust (score IS NULL/unset [anonymous or never-scored] OR >= 15). Feeds ONLY
  -- the ranking frequency component below — the displayed submission_count stays the
  -- true raw count so the MP dashboard never shows a silently-shrunk number.
  SELECT
    c.id, c.title_en, c.category, c.ward, c.submission_count,
    COUNT(s.id) FILTER (WHERE ct.score IS NULL OR ct.score >= 15) AS trusted_count,
    c.first_seen, c.last_seen, c.centroid_lat, c.centroid_lng, c.plan_match,
    AVG(s.severity)::float AS avg_severity,
    -- recency: exponential decay on hours since last submission
    EXP( -LN(2) * EXTRACT(EPOCH FROM (now() - c.last_seen)) / 86400.0 / (SELECT half_life FROM cfg) ) AS recency_raw,
    wd.demo_weight
  FROM clusters c
  JOIN submissions s ON s.cluster_id = c.id AND s.status = 'processed'
  LEFT JOIN citizen_trust ct ON ct.phone = s.phone
  JOIN wards wd ON wd.name = c.ward
  WHERE ($1::text IS NULL OR c.ward = $1)        -- filter params from /api/rank query string
    AND ($2::text IS NULL OR c.category::text = $2)
  GROUP BY c.id, c.plan_match, wd.demo_weight
),
norm AS (
  -- min-max normalize TRUSTED frequency across the filtered set; severity /5; demo_weight already ~1.0 scale
  SELECT *,
    (trusted_count - MIN(trusted_count) OVER ())::float
      / NULLIF(MAX(trusted_count) OVER () - MIN(trusted_count) OVER (), 0) AS freq_n,
    avg_severity / 5.0 AS sev_n,
    recency_raw        AS rec_n,             -- decay already 0–1
    LEAST(demo_weight / 1.2, 1.0) AS demo_n  -- cap at seed max 1.2
  FROM stats
)
SELECT
  n.id AS cluster_id,
  n.title_en, n.category, n.ward, n.submission_count,
  n.first_seen, n.last_seen, n.centroid_lat, n.centroid_lng,
  -- T3/B15: handler passes through when non-null and not {"none":true}
  n.plan_match,
  -- breakdown (API contract: score_breakdown object)
  ROUND(COALESCE(n.freq_n,1)::numeric, 3) AS bd_frequency,
  ROUND(n.sev_n::numeric, 3)              AS bd_severity,
  ROUND(n.rec_n::numeric, 3)              AS bd_recency,
  ROUND(n.demo_n::numeric, 3)             AS bd_demographic,
  -- composite
  ROUND((
    w.w_freq * COALESCE(n.freq_n,1) + w.w_sev * n.sev_n +
    w.w_rec  * n.rec_n              + w.w_demo * n.demo_n
  )::numeric, 3) AS score
FROM norm n, w
ORDER BY score DESC
LIMIT 50;

-- Node handler assembles: weights (SELECT * FROM rank_weights) + rows above → API.md /api/rank shape.
-- sample_submission_ids: separate cheap query per top-N cluster:
--   SELECT id FROM submissions WHERE cluster_id=$1 AND status='processed' ORDER BY submitted_at DESC LIMIT 3;
