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
# GOOGLE_MAPS_API_KEY: served to the SPA via /api/config (referrer-restrict the key!).
# WEB_DATABASE_URL: jannaadi_web non-owner connection — RLS enforced for API reads;
# the worker keeps owner DATABASE_URL.
WEB_SECRETS="$SECRETS,AUTH_SECRET=AUTH_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,WEB_DATABASE_URL=WEB_DATABASE_URL:latest"

# Twilio inbound (multi-modal complaint capture) — web service only. The Account SID
# and public webhook base are non-secret env; the Auth Token is a Secret Manager secret
# (create once: gcloud secrets create TWILIO_AUTH_TOKEN --data-file=- <<< "$TOKEN").
# Optional: when TWILIO_ACCOUNT_SID is unset, the Twilio webhooks simply skip signature
# validation (logged) — so a non-Twilio deploy is unaffected.
WEB_ENV="APP_ROLE=web,DEMO_MODE=$DEMO_MODE,$COMMON_ENV"
if [ -n "${TWILIO_ACCOUNT_SID:-}" ]; then
  WEB_ENV="$WEB_ENV,TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID"
  # If unset, lib/twilio reconstructs the signed URL from the Cloud Run forwarded headers.
  [ -n "${TWILIO_WEBHOOK_BASE_URL:-}" ] && WEB_ENV="$WEB_ENV,TWILIO_WEBHOOK_BASE_URL=$TWILIO_WEBHOOK_BASE_URL"
  WEB_SECRETS="$WEB_SECRETS,TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest"
fi
# WARNING: --set-env-vars REPLACES the service's entire env set. Everything the live
# service needs MUST be passed through here, or a scripted deploy silently wipes it
# (this bit us: ADMIN_EMAILS/AUTH_URL were only ever set ad-hoc). Pass-throughs:
# AUTH_URL       — public origin; without it Auth.js signs OAuth redirects as 0.0.0.0:8080 (login breaks)
# ADMIN_EMAILS   — comma-separated admin allowlist; without it every login is role=citizen
# TWILIO_WA_NUMBER / TWILIO_WA_JOIN_CODE / TWILIO_VOICE_NUMBER — the SubmitPage channels panel
[ -n "${AUTH_URL:-}" ]            && WEB_ENV="$WEB_ENV,AUTH_URL=$AUTH_URL"
[ -n "${ADMIN_EMAILS:-}" ]        && WEB_ENV="$WEB_ENV,ADMIN_EMAILS=$ADMIN_EMAILS"
[ -n "${TWILIO_WA_NUMBER:-}" ]    && WEB_ENV="$WEB_ENV,TWILIO_WA_NUMBER=$TWILIO_WA_NUMBER"
[ -n "${TWILIO_WA_JOIN_CODE:-}" ] && WEB_ENV="$WEB_ENV,TWILIO_WA_JOIN_CODE=$TWILIO_WA_JOIN_CODE"
[ -n "${TWILIO_VOICE_NUMBER:-}" ] && WEB_ENV="$WEB_ENV,TWILIO_VOICE_NUMBER=$TWILIO_VOICE_NUMBER"

# Cloud SQL over unix socket: set INSTANCE_CONNECTION_NAME=project:region:instance
SQL_FLAG=()
[ -n "${INSTANCE_CONNECTION_NAME:-}" ] && SQL_FLAG=(--add-cloudsql-instances "$INSTANCE_CONNECTION_NAME")

# Runtime identity: the default compute SA has none of the roles this app needs
# (Secret Manager, Cloud SQL Client, GCS, Pub/Sub, Discovery Engine). Set
# RUNTIME_SERVICE_ACCOUNT to the SA already granted them, or the deploy will fail
# pulling secrets / connecting to Cloud SQL.
SA_FLAG=()
[ -n "${RUNTIME_SERVICE_ACCOUNT:-}" ] && SA_FLAG=(--service-account "$RUNTIME_SERVICE_ACCOUNT")

echo "→ deploying $SERVICE (web) to $REGION"
gcloud run deploy "$SERVICE" \
  --source . --project "$GCP_PROJECT" --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 1 --memory 1Gi --timeout 120 \
  --set-env-vars "$WEB_ENV" \
  --set-secrets "$WEB_SECRETS" \
  "${SQL_FLAG[@]}" "${SA_FLAG[@]}"

if [ "${DEPLOY_WORKER:-true}" = "true" ]; then
  echo "→ deploying $SERVICE-worker (Pub/Sub consumer) to $REGION"
  gcloud run deploy "$SERVICE-worker" \
    --source . --project "$GCP_PROJECT" --region "$REGION" \
    --no-allow-unauthenticated \
    --min-instances 1 --max-instances 1 --memory 1Gi --no-cpu-throttling \
    --set-env-vars "APP_ROLE=worker,$COMMON_ENV" \
    --set-secrets "$SECRETS" \
    "${SQL_FLAG[@]}" "${SA_FLAG[@]}"
fi

URL=$(gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$REGION" --format 'value(status.url)')
# Health lives at /api/healthz — bare /healthz is shadowed (LB backend health-check
# path / GFE) and never reaches the container; /api/* routes reliably.
echo "→ smoke: $URL/api/healthz"
code=$(curl -s -o /tmp/healthz.json -w '%{http_code}' "$URL/api/healthz")
cat /tmp/healthz.json; echo
[ "$code" = "200" ] || { echo "DEPLOY FAIL: /api/healthz returned $code"; exit 1; }
echo "✓ deployed: $URL (healthz green)"
