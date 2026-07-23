#!/bin/bash
# Show which host port Docker Compose will bind for the frontend.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f docker-compose.yml ]; then
  echo "Run from the KurdLogs project root (docker-compose.yml missing)."
  exit 1
fi

if [ ! -f .env ]; then
  echo "WARNING: No .env file in $(pwd)"
else
  echo "=== .env (HTTP_PORT) ==="
  grep -E '^HTTP_PORT=' .env || echo "HTTP_PORT is not set in .env"
fi

echo ""
echo "=== Shell HTTP_PORT ==="
echo "${HTTP_PORT:-<not set>}"

echo ""
echo "=== Resolved compose ports (frontend) ==="
docker compose config 2>/dev/null | grep -A6 'frontend:' | grep -E 'published|target' || docker compose config | grep -B2 -A8 'frontend:'
