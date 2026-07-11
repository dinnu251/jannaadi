#!/usr/bin/env bash
# scripts/snapshot.sh — freeze the demo state after a clean replay (pre-req for B13).
# Dumps submissions/clusters/audit_events/deadletters (data only, custom format) to
# db/demo_seed.dump and writes data/demo_manifest.json with the counts + expected
# /api/rank top-1 that demo-reset.sh asserts against.
# Usage: DATABASE_URL=... [BASE_URL=... AUTH_SECRET=...] ./scripts/snapshot.sh
#
# pg_dump: uses the host binary if present AND its major version is >= the server's
# (pg_dump refuses to dump a newer server — Cloud SQL runs Postgres 18). Otherwise
# falls back to `docker run postgres:18-alpine pg_dump`, which needs no host install.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL required}"

PSQL="psql $DATABASE_URL -Atq -v ON_ERROR_STOP=1"
DUMP_ARGS=(--data-only --format=custom -t submissions -t clusters -t audit_events -t deadletters)

pg_dump_run() {
  local server_major host_major
  if command -v pg_dump >/dev/null 2>&1; then
    server_major=$(psql "$DATABASE_URL" -Atqc "SHOW server_version_num" | cut -c1-2)
    host_major=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
    if [ "$host_major" -ge "$server_major" ] 2>/dev/null; then
      pg_dump "$DATABASE_URL" "${DUMP_ARGS[@]}" -f db/demo_seed.dump
      return
    fi
    echo "  host pg_dump $host_major < server $server_major — using dockerized client" >&2
  else
    echo "  no pg_dump on PATH — using dockerized client" >&2
  fi
  docker run --rm --network host -v jannaadi_snapshot_tmp:/dump postgres:18-alpine \
    pg_dump "$DATABASE_URL" "${DUMP_ARGS[@]}" -f /dump/demo_seed.dump
  local cid; cid=$(docker create -v jannaadi_snapshot_tmp:/dump postgres:18-alpine true)
  docker cp "$cid:/dump/demo_seed.dump" db/demo_seed.dump
  docker rm "$cid" >/dev/null
}

echo "→ dumping db/demo_seed.dump"
pg_dump_run

SUBS=$($PSQL -c "SELECT count(*) FROM submissions")
CLUSTERS=$($PSQL -c "SELECT count(*) FROM clusters")
DEADS=$($PSQL -c "SELECT count(*) FROM deadletters")
TOP1=$($PSQL -c "
  WITH w AS (SELECT MAX(CASE WHEN key='frequency' THEN weight END) wf,
                    MAX(CASE WHEN key='severity' THEN weight END) ws,
                    MAX(CASE WHEN key='recency' THEN weight END) wr,
                    MAX(CASE WHEN key='demographic' THEN weight END) wd FROM rank_weights)
  SELECT c.id FROM clusters c ORDER BY c.submission_count DESC, c.last_seen DESC LIMIT 1")
# NOTE: top-1 by submission_count is a proxy written at snapshot time; demo-reset
# asserts against the real /api/rank top-1, so regenerate the manifest via the API
# when the server is up:
if [ -n "${BASE_URL:-}" ]; then
  echo "→ reading /api/rank top-1 from $BASE_URL (authenticated)"
  TOP1=$(npx tsx scripts/rank-top1.ts)
fi

cat > data/demo_manifest.json <<EOF
{
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "submission_count": $SUBS,
  "cluster_count": $CLUSTERS,
  "deadletter_count": $DEADS,
  "top1_cluster_id": "$TOP1"
}
EOF
echo "✓ snapshot: $SUBS submissions, $CLUSTERS clusters, $DEADS deadletters, top1=$TOP1"
echo "  db/demo_seed.dump + data/demo_manifest.json written"
