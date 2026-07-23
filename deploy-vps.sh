#!/bin/bash
# Rebuild and restart KurdLogs after uploading new code to the VPS (WinSCP / rsync)
set -euo pipefail

ESC=$'\033'
R="${ESC}[0m"
B="${ESC}[1m"
DIM="${ESC}[2m"
CYAN="${ESC}[38;2;125;211;252m"
MINT="${ESC}[38;2;134;239;172m"
PEARL="${ESC}[38;2;226;232;240m"
MUTED="${ESC}[38;2;148;163;184m"
AMBER="${ESC}[38;2;253;224;71m"
LINE="${ESC}[38;2;51;65;85m"
OK="${ESC}[38;2;74;222;128m"
ERR="${ESC}[38;2;248;113;113m"
PROMPT="${ESC}[38;2;167;139;250m"
BUILD_VERSION='v18.5.5-blueprint-http-uuid-fix'

cd "$(dirname "$0")"

banner() {
  clear 2>/dev/null || true
  echo ""
  echo -e "${CYAN}          ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄${R}"
  echo -e "${CYAN}        ▐█▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▌${R}"
  echo -e "${PEARL}${B}              K U R D L O G S   C O R E${R}"
  echo -e "${MUTED}           VPS deploy · rebuild after upload${R}"
  echo -e "${CYAN}        ▐█▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄█▌${R}"
  echo -e "${CYAN}          ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀${R}"
  echo ""
}

step() {
  local num="$1" title="$2"
  echo ""
  echo -e "${LINE}╭──────────────────────────────────────────────────────────────╮${R}"
  echo -e "${LINE}│${R}  ${AMBER}${B}${num}${R}  ${PEARL}${B}${title}${R}"
  echo -e "${LINE}╰──────────────────────────────────────────────────────────────╯${R}"
  echo ""
}

ok()   { echo -e "  ${OK}${B}✓${R}  ${PEARL}$1${R}"; }
fail() { echo -e "  ${ERR}${B}✗${R}  ${PEARL}$1${R}"; }
info() { echo -e "  ${MUTED}→${R}  $1"; }
cmd()  { echo -e "${PROMPT}${B}❯${R} ${MUTED}kurdlogs${R} ${DIM}›${R} $1"; }

banner

if [ ! -f docker-compose.yml ]; then
  fail "Run from the KurdLogs project folder (e.g. /opt/kurdlogs_core)."
  exit 1
fi

if [ ! -f .env ]; then
  fail "Missing .env — copy .env.example and set PUBLIC_BASE_URL=http://YOUR_IP:8081"
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

if [ -n "${PUBLIC_BASE_URL:-}" ] && ! echo "$PUBLIC_BASE_URL" | grep -qE ':[0-9]+(/|$)'; then
  export PUBLIC_BASE_URL="${PUBLIC_BASE_URL}:${HTTP_PORT}"
  info "PUBLIC_BASE_URL had no port — using ${PUBLIC_BASE_URL}"
fi

step "01" "Preflight"
info "HTTP_PORT=${HTTP_PORT}  PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-unset}"
info "Upload project from PC via WinSCP BEFORE running this script."

if [ -f ./cleanup-vps-orphans.sh ]; then
  cmd "./cleanup-vps-orphans.sh"
  chmod +x ./cleanup-vps-orphans.sh
  ./cleanup-vps-orphans.sh || true
  ok "Orphan cleanup finished"
fi

step "02" "Build images"
cmd "docker compose build backend frontend nginx-rtmp"
docker compose build backend frontend nginx-rtmp
ok "Images built"

step "03" "Recreate containers"
cmd "docker compose up -d --force-recreate"
docker compose up -d --force-recreate postgres nginx-rtmp backend frontend
ok "Containers recreated"

step "04" "Sync Postgres"
cmd "./scripts/sync-postgres-password.sh"
chmod +x scripts/sync-postgres-password.sh
./scripts/sync-postgres-password.sh
ok "Postgres password synced"

step "05" "Verify"
info "waiting for backend..."
sleep 8
docker compose ps
ok "Sidebar build ${BUILD_VERSION} (hard refresh Ctrl+Shift+R)"

echo ""
echo -e "${MINT}  ██████████████████████████████████████████████████████${R}"
echo -e "${PEARL}${B}   KURDLOGS CORE  ·  VPS DEPLOY COMPLETE${R}"
echo -e "${MUTED}   open  →  ${PUBLIC_BASE_URL:-http://YOUR_IP:${HTTP_PORT}}${R}"
echo -e "${MUTED}   login →  admin / admin123${R}"
echo -e "${MINT}  ██████████████████████████████████████████████████████${R}"
echo ""
