-- scripts/fixtures/local-fixture.sql — synthetic processed data for local API
-- verification (no Gemini/GCP needed). NOT for the demo DB — demo state comes from
-- data/generate.ts + replay + snapshot.sh.
BEGIN;
TRUNCATE audit_events, deadletters, submissions, clusters RESTART IDENTITY CASCADE;

-- 768-dim unit-ish vector helper
CREATE OR REPLACE FUNCTION fx_vec(seed float) RETURNS vector AS $$
  SELECT ('[' || array_to_string(array_fill(seed, ARRAY[768]), ',') || ']')::vector
$$ LANGUAGE sql;

-- c1: Gajuwaka drainage — biggest, recent, has a real plan_match (B15 passthrough)
INSERT INTO clusters (id, title_en, category, ward, centroid, centroid_lat, centroid_lng, submission_count, first_seen, last_seen, plan_match) VALUES
('11111111-1111-1111-1111-111111111111', 'Drainage overflow — Gajuwaka Sector 7', 'drainage', 'Gajuwaka',
 fx_vec(0.01), 17.6868, 83.1953, 6, now() - interval '20 days', now() - interval '1 day',
 '{"doc_title":"GVMC Budget 2026-27","snippet":"Ward 58 storm-water drain upgrade allocation","relevance":0.8}'),
-- c2: MVP Colony roads — mid, plan searched but no hit ({none:true} must NOT pass through)
('22222222-2222-2222-2222-222222222222', 'Potholes on MVP main road', 'roads', 'MVP Colony',
 fx_vec(0.02), 17.7386, 83.3350, 3, now() - interval '15 days', now() - interval '3 days',
 '{"none":true}'),
-- c3: Madhurawada water — small, older, plan_match NULL (not yet searched)
('33333333-3333-3333-3333-333333333333', 'Irregular water supply Madhurawada', 'water', 'Madhurawada',
 fx_vec(0.03), 17.8262, 83.3556, 2, now() - interval '40 days', now() - interval '25 days',
 NULL);

-- processed submissions per cluster
INSERT INTO submissions (id, status, channel, lang, raw_text, category, ward, severity, summary_en, summary_original, cluster_id, lat, lng, submitted_at, processed_at, is_synthetic)
SELECT ('a1a1a1a1-0000-0000-0000-00000000000' || i)::uuid, 'processed', 'text', 'te',
       'డ్రైనేజీ సమస్య ' || i, 'drainage', 'Gajuwaka', 4 + (i % 2),
       'Drainage overflow sample ' || i, 'డ్రైనేజీ పొంగడం ' || i,
       '11111111-1111-1111-1111-111111111111', 17.6868 + i * 0.001, 83.1953 + i * 0.001,
       now() - (i || ' days')::interval, now(), true
FROM generate_series(1, 6) i;
INSERT INTO submissions (id, status, channel, lang, raw_text, category, ward, severity, summary_en, summary_original, cluster_id, lat, lng, submitted_at, processed_at, is_synthetic)
SELECT ('b2b2b2b2-0000-0000-0000-00000000000' || i)::uuid, 'processed', 'text', 'mixed',
       'Road gunta ' || i, 'roads', 'MVP Colony', 3,
       'Potholes sample ' || i, 'Road lo gunta ' || i,
       '22222222-2222-2222-2222-222222222222', 17.7386, 83.3350,
       now() - ((i + 2) || ' days')::interval, now(), true
FROM generate_series(1, 3) i;
INSERT INTO submissions (id, status, channel, lang, raw_text, category, ward, severity, summary_en, summary_original, cluster_id, lat, lng, submitted_at, processed_at, is_synthetic)
SELECT ('c3c3c3c3-0000-0000-0000-00000000000' || i)::uuid, 'processed', 'voice', 'hi',
       NULL, 'water', 'Madhurawada', 2,
       'Water supply sample ' || i, 'पानी की समस्या ' || i,
       '33333333-3333-3333-3333-333333333333', 17.8262, 83.3556,
       now() - ((25 + i) || ' days')::interval, now(), true
FROM generate_series(1, 2) i;

-- audit trail for one submission (shape check for /api/submissions/:id incl. B14 field)
INSERT INTO audit_events (submission_id, stage, model, latency_ms, detail) VALUES
('a1a1a1a1-0000-0000-0000-000000000001', 'received',  NULL, NULL, '{"channel":"text","lang_hint":"te"}'),
('a1a1a1a1-0000-0000-0000-000000000001', 'extracted', 'gemini-2.5-flash-002', 840, '{"retry":0}'),
('a1a1a1a1-0000-0000-0000-000000000001', 'extracted', NULL, NULL, '{"ward_resolved_via":"maps_grounding"}'),
('a1a1a1a1-0000-0000-0000-000000000001', 'processed', NULL, NULL, '{"cluster_id":"11111111-1111-1111-1111-111111111111"}');

-- a failed submission + dead letter (B6 surface)
INSERT INTO submissions (id, status, channel, lang, raw_text, submitted_at, is_synthetic) VALUES
('dead0000-0000-0000-0000-000000000001', 'failed', 'text', 'te', 'గుర్తు తెలియని సమస్య వచ్చింది', now() - interval '2 hours', true);
INSERT INTO deadletters (submission_id, failed_stage, reason, raw_response) VALUES
('dead0000-0000-0000-0000-000000000001', 'extracted', 'schema_validation_failed_after_retry', '{"category":"not-a-category"}');

-- one row left in 'received' for the lock-semantics test (B5)
INSERT INTO submissions (id, status, channel, lang, raw_text, ward, submitted_at, is_synthetic) VALUES
('eeee0000-0000-0000-0000-000000000001', 'received', 'text', 'te', 'పెండుర్తి లో రోడ్డు బాగోలేదు', 'Pendurthi', now(), true);

DROP FUNCTION fx_vec(float);
COMMIT;
