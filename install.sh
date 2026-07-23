#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Starting KurdLogs Core installation...${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root (use sudo)${NC}"
  exit 1
fi

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

PUBLIC_IP="$(detect_public_ip)"
HTTP_PORT="${HTTP_PORT:-8081}"

echo -e "${GREEN}1. Updating system...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo -e "${GREEN}2. Installing dependencies...${NC}"
apt-get install -y -qq curl ca-certificates ffmpeg

echo -e "${GREEN}3. Installing Docker...${NC}"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm -f get-docker.sh
else
  echo "Docker already installed."
fi

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin
fi

echo -e "${GREEN}4. Configuring environment...${NC}"
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
  echo -e "${YELLOW}Created .env with auto-generated secrets.${NC}"
else
  echo ".env already exists — keeping your settings."
  # Ensure PUBLIC_BASE_URL is set if missing
  if ! grep -q '^PUBLIC_BASE_URL=' .env; then
    echo "PUBLIC_BASE_URL=http://${PUBLIC_IP}" >> .env
  fi
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

BASE_URL="${PUBLIC_BASE_URL:-http://${PUBLIC_IP}}"
HOST_PORT="${HTTP_PORT:-8081}"

echo -e "${GREEN}5. Building Docker containers (this may take several minutes)...${NC}"
docker compose build

echo -e "${GREEN}6. Starting services...${NC}"
docker compose up -d

echo -e "${BLUE}=======================================${NC}"
echo -e "${GREEN}KurdLogs Core installed successfully!${NC}"
if [ "$HOST_PORT" = "80" ]; then
  echo -e "Dashboard: ${BASE_URL}"
else
  echo -e "Dashboard: ${BASE_URL%/*}:${HOST_PORT}  (port ${HOST_PORT})"
fi
echo -e "Login: admin / admin123"
echo -e ""
echo -e "Useful commands:"
echo -e "  docker compose ps"
echo -e "  docker compose logs -f backend"
echo -e "  ./deploy-vps.sh   (rebuild after updates)"
echo -e "${BLUE}=======================================${NC}"
