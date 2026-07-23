#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

CORE_URL=""
NODE_KEY=""
INSTALL_DIR="/opt/kurdlogs-boost-worker"

usage() {
  cat <<EOF
KurdLogs Boost worker installer

Usage:
  curl -fsSL CORE_URL/api/monitoring/boost/install.sh | bash -s -- --core CORE_URL --key NODE_KEY

Options:
  --core   KurdLogs core URL (e.g. http://YOUR_IP or https://panel.example.com)
  --key    Boost node secret key from Monitoring → Boost
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --core)
      CORE_URL="${2:-}"
      shift 2
      ;;
    --key)
      NODE_KEY="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$CORE_URL" || -z "$NODE_KEY" ]]; then
  echo -e "${RED}Missing --core or --key${NC}"
  usage
  exit 1
fi

CORE_URL="${CORE_URL%/}"

if [[ "$EUID" -ne 0 ]]; then
  echo -e "${RED}Please run as root (sudo)${NC}"
  exit 1
fi

echo -e "${BLUE}Installing KurdLogs Boost worker...${NC}"

echo -e "${GREEN}1. Installing dependencies...${NC}"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y curl ffmpeg ca-certificates
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache curl ffmpeg ca-certificates
else
  echo -e "${RED}Unsupported OS. Install curl and ffmpeg manually.${NC}"
  exit 1
fi

echo -e "${GREEN}2. Creating worker directory...${NC}"
mkdir -p "$INSTALL_DIR"

cat > "$INSTALL_DIR/heartbeat.sh" <<'SCRIPT'
#!/bin/bash
set -euo pipefail

CORE_URL="__CORE_URL__"
NODE_KEY="__NODE_KEY__"

read_cpu() {
  if [[ -r /proc/stat ]]; then
    awk '/^cpu / { idle=$5+$6; total=0; for (i=2;i<=NF;i++) total+=$i; if (total>0) printf "%.1f", (total-idle)*100/total; else print "0" }' /proc/stat
  else
    echo "0"
  fi
}

read_ram() {
  if [[ -r /proc/meminfo ]]; then
    awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END { if (t>0) printf "%.1f", (t-a)*100/t; else print "0" }' /proc/meminfo
  else
    echo "0"
  fi
}

while true; do
  CPU=$(read_cpu)
  RAM=$(read_ram)
  HOST=$(hostname)

  curl -fsS -X POST "${CORE_URL}/api/monitoring/boost/worker/heartbeat" \
    -H "Content-Type: application/json" \
    -H "X-Boost-Key: ${NODE_KEY}" \
    -d "{\"hostname\":\"${HOST}\",\"cpu\":${CPU},\"ram\":${RAM},\"activeChannels\":0,\"version\":\"1.0.0\"}" \
    >/dev/null || true

  sleep 30
done
SCRIPT

sed -i "s|__CORE_URL__|${CORE_URL}|g" "$INSTALL_DIR/heartbeat.sh"
sed -i "s|__NODE_KEY__|${NODE_KEY}|g" "$INSTALL_DIR/heartbeat.sh"
chmod +x "$INSTALL_DIR/heartbeat.sh"

cat > /etc/systemd/system/kurdlogs-boost-worker.service <<EOF
[Unit]
Description=KurdLogs Boost Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/heartbeat.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}3. Starting worker service...${NC}"
systemctl daemon-reload
systemctl enable kurdlogs-boost-worker
systemctl restart kurdlogs-boost-worker

echo -e "${GREEN}4. Verifying connection...${NC}"
sleep 2
if systemctl is-active --quiet kurdlogs-boost-worker; then
  echo -e "${BLUE}=======================================${NC}"
  echo -e "${GREEN}Boost worker installed successfully!${NC}"
  echo -e "Core: ${CORE_URL}"
  echo -e "Status: systemctl status kurdlogs-boost-worker"
  echo -e "Logs:   journalctl -u kurdlogs-boost-worker -f"
  echo -e ""
  echo -e "Open Monitoring → Boost on your core panel — this node should show ONLINE within ~30 seconds."
  echo -e "${BLUE}=======================================${NC}"
else
  echo -e "${RED}Worker service failed to start. Check: journalctl -u kurdlogs-boost-worker -n 50${NC}"
  exit 1
fi
