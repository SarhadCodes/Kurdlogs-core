#!/bin/bash
# Reset KurdLogs channels after a failed GPU deploy or stuck ERROR state
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Backend health ==="
docker compose ps backend

echo ""
echo "=== Encoder mode in container ==="
docker compose exec backend printenv FFMPEG_ENCODER_MODE 2>/dev/null || echo "backend not running"

echo ""
echo "=== FFmpeg encoders (first 3 hardware lines) ==="
docker compose exec backend ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'h264_nvenc|h264_qsv|libx264' | head -5 || true

echo ""
echo "=== Reset all channels to OFFLINE (clears ERROR) ==="
docker compose exec backend node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.channel.updateMany({ data: { status: 'OFFLINE', pid: null } })
  .then((r) => { console.log('Updated', r.count, 'channels'); return p.\$disconnect(); })
  .catch((e) => { console.error(e); process.exit(1); });
"

echo ""
echo "Done. In the UI: open each channel → Stop (if needed) → Start."
echo "Ensure .env has: FFMPEG_ENCODER_MODE=cpu  (no docker-compose.gpu.yml on CPU VPS)"
