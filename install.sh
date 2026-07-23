#!/bin/bash
# KurdLogs Core — branded installer (Linux / VPS)
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

cd "$(dirname "$0")"

banner() {
  clear 2>/dev/null || true
  echo ""
  echo -e "${CYAN}          ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄${R}"
  echo -e "${CYAN}        ▐█▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▌${R}"
  echo -e "${PEARL}${B}              K U R D L O G S   C O R E${R}"
  echo -e "${MUTED}           self-hosted broadcast control panel${R}"
  echo -e "${CYAN}        ▐█▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄█▌${R}"
  echo -e "${CYAN}          ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀${R}"
  echo ""
  echo -e "${LINE}  ┌─ session ─────────────────────────────────────────┐${R}"
  echo -e "${LINE}  │${R}  ${MINT}●${R} live install   ${MUTED}│${R}  docker + apt   ${MUTED}│${R}  VPS / server  ${LINE}│${R}"
  echo -e "${LINE}  └───────────────────────────────────────────────────┘${R}"
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

progress() {
  local label="$1"
  echo -e "${MUTED}  ${label}${R}"
  local i
  for i in $(seq 1 24); do
    local fill empty pct
    fill=$(printf '█%.0s' $(seq 1 "$i"))
    empty=$(printf '░%.0s' $(seq 1 $((24 - i))) 2>/dev/null || true)
    pct=$((100 * i / 24))
    printf "\r  ${CYAN}%s${DIM}%s${R}  ${MUTED}%s%%%R " "$fill" "$empty" "$pct"
    sleep 0.02
  done
  echo ""
}

detect_public_ip() {
  curl -fsS --max-time 8 ifconfig.me 2>/dev/null \
    || curl -fsS --max-time 8 icanhazip.com 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || echo "127.0.0.1"
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    tr -dc 'a-f0-9' </dev/urandom | head -c $(( "$1" * 2 ))
  fi
}

banner

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  fail "Please run as root (use sudo ./install.sh)"
  exit 1
fi

PUBLIC_IP="$(detect_public_ip)"
HTTP_PORT="${HTTP_PORT:-8081}"

step "01" "Update system"
cmd "apt-get update && apt-get upgrade"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
ok "System packages refreshed"

step "02" "Install dependencies"
cmd "apt-get install curl ca-certificates ffmpeg"
apt-get install -y -qq curl ca-certificates ffmpeg
ok "Dependencies installed"

step "03" "Install Docker"
cmd "docker --version || get.docker.com"
if ! command -v docker >/dev/null 2>&1; then
  progress "installing Docker Engine"
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm -f get-docker.sh
else
  info "$(docker --version)"
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin
fi
info "$(docker compose version)"
ok "Docker runtime ready"

step "04" "Configure environment"
if [ ! -f .env ]; then
  cat > .env <<EOF
PUBLIC_BASE_URL=http://${PUBLIC_IP}
JWT_SECRET=$(rand_hex 24)
IPTV_API_KEY=$(rand_hex 16)
POSTGRES_PASSWORD=$(rand_hex 16)
HTTP_PORT=${HTTP_PORT}
RTMP_PORT=1935
TOKEN_OVERLAP_SECONDS=120
TOKEN_REFRESH_AHEAD_SECONDS=90
EOF
  info "Created .env with auto-generated secrets"
else
  info ".env already exists — keeping your settings"
  if ! grep -q '^PUBLIC_BASE_URL=' .env; then
    echo "PUBLIC_BASE_URL=http://${PUBLIC_IP}" >> .env
  fi
fi
ok "Environment ready"

# shellcheck disable=SC1091
set -a
source .env
set +a

BASE_URL="${PUBLIC_BASE_URL:-http://${PUBLIC_IP}}"
HOST_PORT="${HTTP_PORT:-8081}"

step "05" "Build containers"
cmd "docker compose build"
progress "building images (this can take a few minutes)"
docker compose build
ok "Images built"

step "06" "Start services"
cmd "docker compose up -d"
progress "bringing stack online"
docker compose up -d
ok "Services started"

echo ""
echo -e "${MINT}  ██████████████████████████████████████████████████████${R}"
echo -e "${PEARL}${B}   KURDLOGS CORE  ·  INSTALL COMPLETE${R}"
if [ "$HOST_PORT" = "80" ]; then
  echo -e "${MUTED}   open  →  ${BASE_URL}${R}"
else
  echo -e "${MUTED}   open  →  ${BASE_URL%/*}:${HOST_PORT}${R}"
fi
echo -e "${MUTED}   login →  admin / admin123${R}"
echo -e "${MUTED}   tip   →  docker compose ps · docker compose logs -f backend${R}"
echo -e "${MINT}  ██████████████████████████████████████████████████████${R}"
echo ""
