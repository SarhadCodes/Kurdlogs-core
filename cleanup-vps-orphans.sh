#!/bin/bash
# Remove Control Room files left from older uploads (replaced by Hybrid Channel).
# Safe to run on every deploy — only deletes paths that exist.
set -euo pipefail

cd "$(dirname "$0")"

ORPHANS=(
  backend/src/services/controlRoom.service.ts
  backend/src/services/controlRoomLive.service.ts
  backend/src/services/controlRoomProgramEncoder.service.ts
  backend/src/controllers/controlRoom.controller.ts
  backend/src/routes/controlRoom.routes.ts
  backend/src/utils/controlRoomHls.ts
  frontend/src/pages/ControlRoomPage.tsx
  frontend/src/types/controlRoom.ts
)

removed=0
for f in "${ORPHANS[@]}"; do
  if [ -f "$f" ]; then
    echo "Removing orphan: $f"
    rm -f "$f"
    removed=$((removed + 1))
  fi
done

if [ "$removed" -eq 0 ]; then
  echo "No Control Room orphan files found."
else
  echo "Removed $removed orphan file(s)."
fi
