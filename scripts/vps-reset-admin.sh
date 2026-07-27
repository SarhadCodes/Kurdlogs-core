#!/bin/bash
# Reset admin password when backend is crash-looping (run on VPS from project folder)
set -euo pipefail
cd "$(dirname "$0")/.."

NEW_PASSWORD="Kl-$(openssl rand -hex 10)9A"
if [ -f .env ]; then
  if grep -qE '^ADMIN_INITIAL_PASSWORD=' .env; then
    tmpfile="$(mktemp)"
    sed "s|^ADMIN_INITIAL_PASSWORD=.*|ADMIN_INITIAL_PASSWORD=${NEW_PASSWORD}|" .env > "$tmpfile"
    mv "$tmpfile" .env
  else
    printf '\nADMIN_INITIAL_PASSWORD=%s\n' "${NEW_PASSWORD}" >> .env
  fi
fi

echo "Resetting admin user via one-off backend container..."
docker compose run --rm --no-deps -e RESET_ADMIN_PASSWORD="${NEW_PASSWORD}" backend node -e "
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const password = process.env.RESET_ADMIN_PASSWORD;
bcrypt.hash(password, 12).then((hash) =>
  p.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: hash, mustChangePassword: false, role: 'ADMIN', mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null },
    create: { username: 'admin', passwordHash: hash, role: 'ADMIN', mustChangePassword: false },
  })
).then(() => {
  console.log('Done — username: admin');
  console.log('password: ' + password);
  return p.\$disconnect();
}).catch((e) => { console.error(e); process.exit(1); });
"

echo "Restarting backend..."
docker compose up -d backend
sleep 5
docker compose ps backend
echo "Login with:"
echo "  username → admin"
echo "  password → ${NEW_PASSWORD}"
