#!/bin/bash
# KurdLogs Core — public installer (downloads binaries only, never the source)
# Usage:
#   curl -fsSL https://kurdlogs-core.sarhadyt.workers.dev/install.sh | sudo bash
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

DIST_BASE="${KURDLOGS_DIST_BASE:-https://kurdlogs-core.sarhadyt.workers.dev}"
INSTALL_DIR="${KURDLOGS_INSTALL_DIR:-/opt/kurdlogs-core}"
IMAGE_TAG="${KURDLOGS_IMAGE_TAG:-1.2.0}"

banner() {
  clear 2>/dev/null || true
  echo ""
  echo -e "${CYAN}          ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄${R}"
  echo -e "${CYAN}        ▐█▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█▌${R}"
  echo -e "${PEARL}${B}              K U R D L O G S   C O R E${R}"
  echo -e "${MUTED}           free binary install · source stays private${R}"
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

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" .env 2>/dev/null; then
    local tmpfile
    tmpfile="$(mktemp)"
    sed "s|^${key}=.*|${key}=${value}|" .env > "$tmpfile"
    mv "$tmpfile" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

banner

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  fail "Please run as root (use sudo bash)"
  exit 1
fi

PUBLIC_IP="$(detect_public_ip)"
HTTP_PORT="${HTTP_PORT:-8081}"

step "01" "Install runtime dependencies"
cmd "apt-get install curl ca-certificates"
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates
fi
ok "Dependencies ready"

step "02" "Install Docker"
cmd "docker --version || get.docker.com"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
else
  info "$(docker --version)"
fi
if ! docker compose version >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y -qq docker-compose-plugin
  else
    fail "Docker Compose plugin is required"
    exit 1
  fi
fi
ok "Docker runtime ready"

step "03" "Download release package (no source)"
cmd "mkdir -p ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"
curl -fsSL "${DIST_BASE}/release/docker-compose.yml" -o docker-compose.yml
ok "Compose file installed to ${INSTALL_DIR}"

step "04" "Configure environment"
ADMIN_PASSWORD_SHOWN=""
if [ ! -f .env ]; then
  ADMIN_PASSWORD_SHOWN="Kl-$(rand_hex 10)9A"
  cat > .env <<EOF
PUBLIC_BASE_URL=http://${PUBLIC_IP}:${HTTP_PORT}
JWT_SECRET=$(rand_hex 24)
ADMIN_INITIAL_PASSWORD=${ADMIN_PASSWORD_SHOWN}
IPTV_API_KEY=$(rand_hex 16)
POSTGRES_PASSWORD=$(rand_hex 16)
HTTP_PORT=${HTTP_PORT}
RTMP_PUBLISH_PORT=1936
MCR_RTMP_PORT=1936
TOKEN_OVERLAP_SECONDS=120
TOKEN_REFRESH_AHEAD_SECONDS=90
KURDLOGS_RELEASE=${IMAGE_TAG}
KURDLOGS_IMAGE_BACKEND=ghcr.io/sarhadcodes/kurdlogs-core-backend:${IMAGE_TAG}
KURDLOGS_IMAGE_FRONTEND=ghcr.io/sarhadcodes/kurdlogs-core-frontend:${IMAGE_TAG}
KURDLOGS_IMAGE_NGINX=ghcr.io/sarhadcodes/kurdlogs-core-nginx:${IMAGE_TAG}
EOF
  info "Created .env with auto-generated secrets"
else
  ADMIN_PASSWORD_SHOWN="$(grep -E '^ADMIN_INITIAL_PASSWORD=' .env 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true)"
  if [ -z "${ADMIN_PASSWORD_SHOWN}" ]; then
    ADMIN_PASSWORD_SHOWN="Kl-$(rand_hex 10)9A"
    if grep -qE '^ADMIN_INITIAL_PASSWORD=' .env 2>/dev/null; then
      # replace empty value
      tmpfile="$(mktemp)"
      sed "s|^ADMIN_INITIAL_PASSWORD=.*|ADMIN_INITIAL_PASSWORD=${ADMIN_PASSWORD_SHOWN}|" .env > "$tmpfile"
      mv "$tmpfile" .env
    else
      printf '\nADMIN_INITIAL_PASSWORD=%s\n' "${ADMIN_PASSWORD_SHOWN}" >> .env
    fi
    info "Added ADMIN_INITIAL_PASSWORD to existing .env"
  else
    info ".env already exists — keeping your settings"
  fi
fi

set_env_value "KURDLOGS_RELEASE" "${IMAGE_TAG}"
set_env_value "KURDLOGS_IMAGE_BACKEND" "ghcr.io/sarhadcodes/kurdlogs-core-backend:${IMAGE_TAG}"
set_env_value "KURDLOGS_IMAGE_FRONTEND" "ghcr.io/sarhadcodes/kurdlogs-core-frontend:${IMAGE_TAG}"
set_env_value "KURDLOGS_IMAGE_NGINX" "ghcr.io/sarhadcodes/kurdlogs-core-nginx:${IMAGE_TAG}"
info "Release images set to ${IMAGE_TAG}"
ok "Environment ready"

step "05" "Pull binary images"
cmd "docker compose pull"
if ! docker compose pull; then
  missing=0
  for img in \
    "ghcr.io/sarhadcodes/kurdlogs-core-backend:${IMAGE_TAG}" \
    "ghcr.io/sarhadcodes/kurdlogs-core-frontend:${IMAGE_TAG}" \
    "ghcr.io/sarhadcodes/kurdlogs-core-nginx:${IMAGE_TAG}"
  do
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      fail "Missing image: $img"
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    fail "Public GHCR images are not available yet. Owner must publish them (Actions → Publish release images) and set packages to Public."
    exit 1
  fi
  info "Registry pull failed, but local images were found — continuing"
else
  ok "Images downloaded"
fi

step "06" "Start KurdLogs Core"
cmd "docker compose up -d --pull always --force-recreate"
docker compose up -d --pull always --force-recreate

PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r' || true)"
if [ -n "${PG_PASS}" ]; then
  for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
      docker compose exec -T postgres psql -U postgres -c "ALTER USER postgres PASSWORD '${PG_PASS}';" >/dev/null 2>&1 || true
      docker compose up -d --force-recreate backend >/dev/null 2>&1 || true
      break
    fi
    sleep 2
  done
fi

if [ -n "${ADMIN_PASSWORD_SHOWN}" ]; then
  admin_synced=0
  for _ in $(seq 1 45); do
    if docker compose exec -T backend node dist/scripts/reset-admin.js "${ADMIN_PASSWORD_SHOWN}" >/dev/null 2>&1; then
      admin_synced=1
      break
    fi
    sleep 2
  done
  if [ "$admin_synced" -eq 1 ]; then
    ok "Admin login synced to installer password"
  else
    fail "Could not sync admin password yet — wait a minute and run:"
    info "docker compose exec -T backend node dist/scripts/reset-admin.js \"${ADMIN_PASSWORD_SHOWN}\""
  fi
fi

ok "Services started"

BASE_URL="http://${PUBLIC_IP}:${HTTP_PORT}"
echo ""
echo -e "${MINT}  ██████████████████████████████████████████████████████${R}"
echo -e "${PEARL}${B}   KURDLOGS CORE  ·  INSTALL COMPLETE${R}"
echo -e "${MUTED}   release  →  ${IMAGE_TAG}${R}"
echo -e "${MUTED}   open      →  ${BASE_URL}${R}"
echo -e "${MUTED}   username →  admin${R}"
echo -e "${AMBER}   password →  ${ADMIN_PASSWORD_SHOWN}${R}"
echo -e "${MUTED}   path     →  ${INSTALL_DIR}${R}"
echo -e "${MUTED}   tip      →  cd ${INSTALL_DIR} && docker compose logs -f backend${R}"
echo -e "${MINT}  ██████████████████████████████████████████████████████${R}"
echo ""
