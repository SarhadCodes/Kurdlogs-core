#!/bin/bash
# Sync Postgres role password to match POSTGRES_PASSWORD in .env
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example first."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "POSTGRES_PASSWORD not set in .env"
  exit 1
fi

echo "Syncing Postgres password from .env..."
docker compose exec -T postgres psql -U postgres -c "ALTER USER postgres PASSWORD '${POSTGRES_PASSWORD}';"

echo "Restarting backend..."
docker compose restart backend
echo "Done."
