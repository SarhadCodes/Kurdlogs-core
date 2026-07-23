#!/bin/bash
# Quick GPU / NVENC check on the VPS host or inside the backend container
set -euo pipefail

echo "=== NVIDIA driver ==="
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv
else
  echo "nvidia-smi not found — no NVIDIA driver on host?"
fi

echo ""
echo "=== Docker NVIDIA runtime ==="
docker info 2>/dev/null | grep -i nvidia || echo "No nvidia runtime in docker info"

echo ""
echo "=== FFmpeg NVENC (host) ==="
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'h264_nvenc|h264_qsv|h264_vaapi' || echo "No hardware H.264 encoders in host ffmpeg"
else
  echo "ffmpeg not installed on host"
fi

echo ""
echo "=== KurdLogs backend container ==="
if docker compose ps backend 2>/dev/null | grep -q Up; then
  docker compose exec backend ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'h264_nvenc|h264_qsv|h264_vaapi' || true
  docker compose exec backend wget -qO- http://127.0.0.1:3001/api/monitoring/gpu 2>/dev/null || \
    docker compose exec backend node -e "console.log('Rebuild backend for /api/monitoring/gpu')"
else
  echo "backend container is not running"
fi
