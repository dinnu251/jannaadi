#!/usr/bin/env bash
# infra/setup.sh — One-shot GCP infra provisioning for JanNaadi.
# Run ONCE before deploy.sh. Idempotent — safe to re-run.
#
# Prerequisites on your machine:
#   gcloud auth login && gcloud auth application-default login
#   gcloud components install cloud-sql-proxy  (optional, for psql access)
#
# Required env vars (pass on CLI or export before running):
#   GEMINI_API_KEY     — from https://aistudio.google.com/apikey
#   GOOGLE_MAPS_KEY    — from GCP Console > APIs & Services > Credentials
#   DB_PASSWORD        — choose a strong password for the DB owner
#
# Optional:
#   PLAN_DATASTORE_ID  — Discovery Engine datastore ID (T3, can add later)
#
# Usage:
#   GEMINI_API_KEY=... GOOGLE_MAPS_KEY=... DB_PASSWORD=... ./infra/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="jannaadi"
REGION="asia-south1"
INSTANCE="jannaadi-db"
DB_NAME="jannaadi"
DB_USER="jannaadi_owner"
WEB_USER="jannaadi_web"
BUCKET="jannaadi-media"
PUBSUB_TOPIC="submissions"
PUBSUB_SUB="submissions-worker"
SERVICE="jannaadi"

: "${GEMINI_API_KEY:?GEMINI_API_KEY required}"
: "${GOOGLE_MAPS_KEY:?GOOGLE_MAPS_KEY required}"
: "${DB_PASSWORD:?DB_PASSWORD required}"
WEB_PASSWORD="${WEB_PASSWORD:-$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c20)}"
AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"

echo "=== JanNaadi Infra Setup · project=$PROJECT region=$REGION ==="
gcloud config set project "$PROJECT"

# ── Step 1: Enable APIs ──────────────────────────────────────────────────────
echo ""
echo "→ [1/8] Enabling APIs..."
gcloud services enable \
  sqladmin.googleapis.com \
  pubsub.googleapis.com \
  storage.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com \
  discoveryengine.googleapis.com \
  --project="$PROJECT" --quiet
echo "   ✓ APIs enabled"

# ── Step 2: Cloud SQL ────────────────────────────────────────────────────────
echo ""
echo "→ [2/8] Cloud SQL (Postgres 15 + pgvector, ~5 min)..."
if gcloud sql instances describe "$INSTANCE" --project="$PROJECT" &>/dev/null; then
  echo "   ✓ Instance $INSTANCE already exists, skipping create"
else
  gcloud sql instances create "$INSTANCE" \
    --database-version=POSTGRES_15 \
    --region="$REGION" \
    --tier=db-f1-micro \
    --storage-size=10GB \
    --storage-auto-increase \
    --project="$PROJECT"
  echo "   ✓ Instance created"
fi

if gcloud sql databases describe "$DB_NAME" --instance="$INSTANCE" --project="$PROJECT" &>/dev/null; then
  echo "   ✓ Database $DB_NAME already exists"
else
  gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" --project="$PROJECT"
  echo "   ✓ Database created"
fi

# Create owner user
gcloud sql users create "$DB_USER" \
  --instance="$INSTANCE" --project="$PROJECT" \
  --password="$DB_PASSWORD" 2>/dev/null || \
  gcloud sql users set-password "$DB_USER" \
    --instance="$INSTANCE" --project="$PROJECT" \
    --password="$DB_PASSWORD"
echo "   ✓ Owner user $DB_USER set"

CONN_NAME=$(gcloud sql instances describe "$INSTANCE" \
  --project="$PROJECT" --format='value(connectionName)')
echo "   Connection name: $CONN_NAME"

# ── Step 3: Apply DB schema via Cloud SQL Auth Proxy ────────────────────────
echo ""
echo "→ [3/8] Applying schema (seed.sql, wards, population)..."
echo "   Downloading Cloud SQL Auth Proxy..."
if ! command -v cloud-sql-proxy &>/dev/null; then
  curl -fsSL "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.linux.amd64" \
    -o /tmp/cloud-sql-proxy && chmod +x /tmp/cloud-sql-proxy
  PROXY=/tmp/cloud-sql-proxy
else
  PROXY=cloud-sql-proxy
fi

echo "   Starting proxy on port 5433..."
"$PROXY" --port=5433 "${CONN_NAME}" &
PROXY_PID=$!
sleep 3

PG="psql postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5433/${DB_NAME}"

echo "   Installing pgvector..."
$PG -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true

echo "   Applying db/seed.sql..."
$PG -f db/seed.sql

echo "   Applying data/wards_real.sql (98 wards + ward_number extraction)..."
$PG -f data/wards_real.sql

echo "   Applying db/ward_population.sql (census weights for wards 1-72)..."
$PG -f db/ward_population.sql

echo "   Applying db/rls_policies.sql (RLS + jannaadi_web role)..."
# Uncomment the CREATE ROLE line before running
WEB_PASS="$WEB_PASSWORD" $PG -c "
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$WEB_USER') THEN
    EXECUTE format('CREATE ROLE $WEB_USER LOGIN PASSWORD %L', '$WEB_PASSWORD');
  END IF;
END \$\$;
"
$PG -f db/rls_policies.sql

kill "$PROXY_PID" 2>/dev/null || true
echo "   ✓ Schema applied"

# ── Step 4: Pub/Sub ──────────────────────────────────────────────────────────
echo ""
echo "→ [4/8] Pub/Sub..."
gcloud pubsub topics create "$PUBSUB_TOPIC" --project="$PROJECT" 2>/dev/null \
  && echo "   ✓ Topic created" || echo "   ✓ Topic already exists"
gcloud pubsub subscriptions create "$PUBSUB_SUB" \
  --topic="$PUBSUB_TOPIC" \
  --ack-deadline=300 \
  --project="$PROJECT" 2>/dev/null \
  && echo "   ✓ Subscription created" || echo "   ✓ Subscription already exists"

# ── Step 5: GCS bucket ───────────────────────────────────────────────────────
echo ""
echo "→ [5/8] GCS bucket..."
gsutil mb -l "$REGION" -p "$PROJECT" "gs://${BUCKET}" 2>/dev/null \
  && echo "   ✓ Bucket gs://${BUCKET} created" || echo "   ✓ Bucket already exists"

# ── Step 6: Secret Manager ───────────────────────────────────────────────────
echo ""
echo "→ [6/8] Secrets..."
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CONN_NAME}"
WEB_DB_URL="postgresql://${WEB_USER}:${WEB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CONN_NAME}"

create_or_update_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" --project="$PROJECT" &>/dev/null; then
    echo -n "$value" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT"
    echo "   ✓ $name updated"
  else
    echo -n "$value" | gcloud secrets create "$name" --data-file=- --project="$PROJECT"
    echo "   ✓ $name created"
  fi
}

create_or_update_secret "GEMINI_API_KEY"  "$GEMINI_API_KEY"
create_or_update_secret "DATABASE_URL"    "$DB_URL"
create_or_update_secret "WEB_DATABASE_URL" "$WEB_DB_URL"
create_or_update_secret "AUTH_SECRET"     "$AUTH_SECRET"
create_or_update_secret "GOOGLE_MAPS_API_KEY" "$GOOGLE_MAPS_KEY"

echo ""
echo "   ⚠️  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET still needed (OAuth step below)."
echo "   ⚠️  PLAN_DATASTORE_ID still needed (T3 Discovery Engine step below)."

# ── Step 7: Cloud Run service account permissions ────────────────────────────
echo ""
echo "→ [7/8] Service account permissions..."
SA="${PROJECT}@appspot.gserviceaccount.com"
# Grant Cloud Run default SA access to secrets + SQL + pubsub
for ROLE in roles/secretmanager.secretAccessor roles/cloudsql.client roles/pubsub.publisher roles/pubsub.subscriber roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="$ROLE" --quiet 2>/dev/null || true
done

# Also try the compute default SA which Cloud Run uses
COMPUTE_SA=$(gcloud iam service-accounts list --project="$PROJECT" \
  --filter="email~compute" --format='value(email)' | head -1)
if [ -n "${COMPUTE_SA:-}" ]; then
  for ROLE in roles/secretmanager.secretAccessor roles/cloudsql.client roles/pubsub.publisher roles/pubsub.subscriber roles/storage.objectAdmin; do
    gcloud projects add-iam-policy-binding "$PROJECT" \
      --member="serviceAccount:${COMPUTE_SA}" \
      --role="$ROLE" --quiet 2>/dev/null || true
  done
fi
echo "   ✓ IAM bindings set"

# ── Step 8: Print what's still needed ────────────────────────────────────────
echo ""
echo "=== ✅ Core infra done. Two manual steps remain: ==="
echo ""
echo "  I-9 — OAuth credentials:"
echo "    GCP Console → APIs & Services → OAuth consent screen → External"
echo "    Then: Credentials → Create OAuth 2.0 Client ID → Web application"
echo "    Authorized redirect URI: https://YOUR_CLOUD_RUN_URL/api/auth/callback/google"
echo "    Then run:"
echo "      echo -n 'YOUR_CLIENT_ID'     | gcloud secrets create GOOGLE_CLIENT_ID --data-file=-"
echo "      echo -n 'YOUR_CLIENT_SECRET' | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-"
echo ""
echo "  T3 — Discovery Engine (optional, for plan_match / B15):"
echo "    GCP Console → Discovery Engine → Create App → Search → datastore ID: vizag-dev-plans"
echo "    Upload 2-3 GVMC PDF documents, then:"
echo "      echo -n 'vizag-dev-plans' | gcloud secrets create PLAN_DATASTORE_ID --data-file=-"
echo ""
echo "  Then deploy:"
echo "    GCP_PROJECT=$PROJECT GCS_BUCKET=$BUCKET \\"
echo "    INSTANCE_CONNECTION_NAME=$CONN_NAME \\"
echo "    ./infra/deploy.sh"
echo ""
echo "=== Setup complete ==="
echo "DB_URL (for reference only, already in Secret Manager):"
echo "  $DB_URL"
echo "WEB_DB_URL:"
echo "  $WEB_DB_URL"
echo "AUTH_SECRET (already in Secret Manager):"
echo "  $AUTH_SECRET"
