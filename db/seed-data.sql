-- db/seed-data.sql — rank_weights + app_config INSERT only.
-- Safe to run after seed.sql has already created the schema (ON CONFLICT DO NOTHING).
-- Use this when re-seeding after a truncate, to avoid the "type already exists" error.

INSERT INTO rank_weights (key, weight) VALUES
  ('frequency',   0.400),
  ('severity',    0.250),
  ('recency',     0.200),
  ('demographic', 0.150)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_config (key, val) VALUES
  ('cluster_similarity_threshold', '0.83'),
  ('stt_confidence_floor',         '0.60'),
  ('recency_half_life_days',       '30'),
  ('gemini_model',                 'gemini-2.5-flash')
ON CONFLICT (key) DO NOTHING;
