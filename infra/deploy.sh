#!/usr/bin/env bash
# infra/deploy.sh — Cloud Run deploy, asia-south1, secrets from Secret Manager.
# Prereqs (orchestrator checklist I-1..6): Cloud SQL + seed applied, Pub/Sub topic
# 'submissions' + sub 'submissions-worker', GCS bucket, secrets created:
#   gcloud secrets create GEMINI_API_KEY  --data-file=- <<< "$KEY"
#   gcloud secrets create DATABASE_URL    --data-file=- <<< "postgres://..."
# Usage: GCP_PROJECT=... GCS_BUCKET=... [PLAN_DATASTORE_ID=...] ./infra/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GCP_PROJECT:?GCP_PROJECT required}"
: "${GCS_BUCKET:?GCS_BUCKET required}"
REGION="${REGION:-asia-south1}"
SERVICE="${CLOUD_RUN_SERVICE:-jannaadi}"
DEMO_MODE="${DEMO_MODE:-true}"

COMMON_ENV="GCP_PROJECT=$GCP_PROJECT,GCS_BUCKET=$GCS_BUCKET,PUBSUB_TOPIC=submissions"
[ -n "${PLAN_DATASTORE_ID:-}" ] && COMMON_ENV="$COMMON_ENV,PLAN_DATASTORE_ID=$PLAN_DATASTORE_ID"
SECRETS="GEMINI_API_KEY=GEMINI_API_KEY:latest,DATABASE_URL=DATABASE_URL:latest"
# Auth.js (web only): AUTH_SECRET (openssl rand -base64 32), Google OAuth client.
# Create once: gcloud secrets create AUTH_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
WEB_SECRETS="$SECRETS,AUTH_SECRET=AUTH_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest"
# Cloud SQL over unix socket: set INSTANCE_CONNECTION_NAME=project:region:instance
SQL_FLAG=()
[ -n "${INSTANCE_CONNECTION_NAME:-}" ] && SQL_FLAG=(--add-cloudsql-instances "$INSTANCE_CONNECTION_NAME")

echo "→ deploying $SERVICE (web) to $REGION"
gcloud run deploy "$SERVICE" \
  --source . --project "$GCP_PROJECT" --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 1 --memory 1Gi --timeout 120 \
  --set-env-vars "APP_ROLE=web,DEMO_MODE=$DEMO_MODE,$COMMON_ENV" \
  --set-secrets "$WEB_SECRETS" \
  "${SQL_FLAG[@]}"

if [ "${DEPLOY_WORKER:-true}" = "true" ]; then
  echo "→ deploying $SERVICE-worker (Pub/Sub consumer) to $REGION"
  gcloud run deploy "$SERVICE-worker" \
    --source . --project "$GCP_PROJECT" --region "$REGION" \
    --no-allow-unauthenticated \
    --min-instances 1 --max-instances 1 --memory 1Gi --no-cpu-throttling \
    --set-env-vars "APP_ROLE=worker,$COMMON_ENV" \
    --set-secrets "$SECRETS" \
    "${SQL_FLAG[@]}"
fi

URL=$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format 'value(status.url)')
echo "→ smoke: $URL/healthz"
code=$(curl -s -o /tmp/healthz.json -w '%{http_code}' "$URL/healthz")
cat /tmp/healthz.json; echo
[ "$code" = "200" ] || { echo "DEPLOY FAIL: /healthz returned $code"; exit 1; }
echo "✓ deployed: $URL (healthz green)"
