#!/usr/bin/env bash
# scripts/demo-reset.sh — reset to the frozen demo state (docs/DEMO.md spec, B13).
# 1. truncate submissions/clusters/deadletters (+audit_events, FK child)
# 2. pg_restore db/demo_seed.dump (800 rows, embeddings frozen, clusters pre-assigned)
# 3. purge Pub/Sub subscription backlog
# 4. set DEMO_MODE=true on the Cloud Run service
# 5. assert row counts + /api/rank top-1 against data/demo_manifest.json
# 6. exit 1 loudly on any failure
#
# Env: DATABASE_URL (required), BASE_URL (required for assert 5c),
#      GCP_PROJECT + PUBSUB_SUBSCRIPTION for step 3, CLOUD_RUN_SERVICE for step 4.
#      LOCAL_ONLY=true skips the two gcloud steps (local rehearsal only).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL required}"

DUMP=db/demo_seed.dump
MANIFEST=data/demo_manifest.json
[ -f "$DUMP" ] || { echo "FATAL: $DUMP missing — run scripts/snapshot.sh after the replay gate"; exit 1; }
[ -f "$MANIFEST" ] || { echo "FATAL: $MANIFEST missing — run scripts/snapshot.sh"; exit 1; }

PSQL="psql $DATABASE_URL -Atq -v ON_ERROR_STOP=1"

echo "→ 1/5 truncate"
$PSQL -c "TRUNCATE audit_events, deadletters, submissions, clusters RESTART IDENTITY CASCADE"

echo "→ 2/5 restore $DUMP"
# table-at-a-time restore in FK-safe order (clusters before submissions —
# submissions.cluster_id references clusters)
for t in clusters submissions audit_events deadletters; do
  pg_restore --data-only --no-owner -t "$t" -d "$DATABASE_URL" "$DUMP"
done
# -t table restore skips SEQUENCE SET entries — realign serials so new inserts don't collide
$PSQL -c "SELECT setval('audit_events_id_seq', COALESCE((SELECT MAX(id) FROM audit_events), 1))" >/dev/null
$PSQL -c "SELECT setval('deadletters_id_seq',  COALESCE((SELECT MAX(id) FROM deadletters),  1))" >/dev/null

if [ "${LOCAL_ONLY:-false}" = "true" ]; then
  echo "→ 3/5 + 4/5 SKIPPED (LOCAL_ONLY=true — no Pub/Sub purge, no Cloud Run env update)"
else
  echo "→ 3/5 purge Pub/Sub backlog"
  gcloud pubsub subscriptions seek "${PUBSUB_SUBSCRIPTION:-submissions-worker}" \
    --time="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --project "${GCP_PROJECT:?GCP_PROJECT required for Pub/Sub purge}"
  echo "→ 4/5 DEMO_MODE=true on Cloud Run"
  gcloud run services update "${CLOUD_RUN_SERVICE:-jannaadi}" --region asia-south1 \
    --update-env-vars DEMO_MODE=true --project "$GCP_PROJECT"
fi

echo "→ 5/5 asserts"
want_subs=$(node -pe "JSON.parse(require('fs').readFileSync('$MANIFEST','utf8')).submission_count")
want_clusters=$(node -pe "JSON.parse(require('fs').readFileSync('$MANIFEST','utf8')).cluster_count")
want_top1=$(node -pe "JSON.parse(require('fs').readFileSync('$MANIFEST','utf8')).top1_cluster_id")

got_subs=$($PSQL -c "SELECT count(*) FROM submissions")
got_clusters=$($PSQL -c "SELECT count(*) FROM clusters")
[ "$got_subs" = "$want_subs" ] || { echo "ASSERT FAIL: submissions $got_subs != $want_subs"; exit 1; }
[ "$got_clusters" = "$want_clusters" ] || { echo "ASSERT FAIL: clusters $got_clusters != $want_clusters"; exit 1; }

if [ -n "${BASE_URL:-}" ]; then
  # /api/rank requires auth — rank-top1.ts mints a session with AUTH_SECRET
  got_top1=$(npx tsx scripts/rank-top1.ts)
  [ "$got_top1" = "$want_top1" ] || { echo "ASSERT FAIL: /api/rank top-1 $got_top1 != $want_top1"; exit 1; }
  echo "✓ top-1 cluster matches manifest ($got_top1)"
else
  echo "ASSERT FAIL: BASE_URL not set — cannot verify /api/rank top-1 (required by DEMO.md step 5)"
  exit 1
fi

echo "✓ demo reset clean: $got_subs submissions, $got_clusters clusters"
