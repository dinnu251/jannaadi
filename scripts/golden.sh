#!/usr/bin/env bash
# scripts/golden.sh — B11 gate. 15/15 or exit 1 (docs/GOLDEN.md).
# Requires: a running JanNaadi API with DEMO_MODE=true (BASE_URL, default localhost:3000),
# GEMINI_API_KEY + DATABASE_URL + GCS_BUCKET configured on that server,
# and golden media committed under assets/golden/.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npx tsx scripts/golden.ts "$@"
