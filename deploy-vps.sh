#!/bin/bash
# Rebuild and restart KurdLogs after uploading new code to the VPS (WinSCP / rsync)
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'
BUILD_VERSION='v18.5.5-blueprint-http-uuid-fix'

cd "$(dirname "$0")"

if [ ! -f docker-compose.yml ]; then
  echo "Run this script from the KurdLogs project folder (e.g. /opt/kurdlogs_core)."
  exit 1
fi

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and set PUBLIC_BASE_URL=http://YOUR_IP:8081"
  exit 1
fi

sed -i 's/\r$//' .env 2>/dev/null || true
sed -i 's/\r$//' deploy-vps.sh 2>/dev/null || true
if [ -f scripts/sync-postgres-password.sh ]; then
  sed -i 's/\r$//' scripts/sync-postgres-password.sh 2>/dev/null || true
  chmod +x scripts/sync-postgres-password.sh
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

HTTP_PORT="${HTTP_PORT:-8081}"
export HTTP_PORT

# Ensure PUBLIC_BASE_URL includes web port when omitted
if [ -n "${PUBLIC_BASE_URL:-}" ] && ! echo "$PUBLIC_BASE_URL" | grep -qE ':[0-9]+(/|$)'; then
  export PUBLIC_BASE_URL="${PUBLIC_BASE_URL}:${HTTP_PORT}"
  echo -e "${YELLOW}PUBLIC_BASE_URL had no port — using ${PUBLIC_BASE_URL}${NC}"
fi

echo -e "${BLUE}Using HTTP_PORT=${HTTP_PORT} PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-unset}${NC}"
echo -e "${YELLOW}Upload project from PC via WinSCP BEFORE running this script.${NC}"
echo ""

if [ -f ./cleanup-vps-orphans.sh ]; then
  echo -e "${BLUE}Cleaning old orphan files (if any)...${NC}"
  chmod +x ./cleanup-vps-orphans.sh
  ./cleanup-vps-orphans.sh || true
  echo ""
fi

echo -e "${BLUE}Building backend + frontend + nginx-rtmp...${NC}"
docker compose build backend frontend nginx-rtmp

echo -e "${BLUE}Recreating containers...${NC}"
docker compose up -d --force-recreate postgres nginx-rtmp backend frontend

echo -e "${BLUE}Syncing Postgres password (prevents backend auth crash)...${NC}"
chmod +x scripts/sync-postgres-password.sh
./scripts/sync-postgres-password.sh

echo -e "${BLUE}Waiting for backend...${NC}"
sleep 8
docker compose ps

echo ""
echo -e "${GREEN}Deploy done.${NC}"
echo -e "Open: ${PUBLIC_BASE_URL:-http://YOUR_IP:${HTTP_PORT}}"
echo -e "Sidebar build: ${GREEN}${BUILD_VERSION}${NC} (hard refresh Ctrl+Shift+R)"
echo ""
echo "Login: admin / admin123 (change after first login)"
echo "If login fails: check docker compose logs backend --tail 50"
