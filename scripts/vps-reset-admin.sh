#!/bin/bash
# Reset admin password when backend is crash-looping (run on VPS from project folder)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Resetting admin user via one-off backend container..."
docker compose run --rm --no-deps backend node -e "
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
bcrypt.hash('admin123', 10).then((hash) =>
  p.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: hash, mustChangePassword: true, role: 'ADMIN' },
    create: { username: 'admin', passwordHash: hash, role: 'ADMIN', mustChangePassword: true },
  })
).then(() => {
  console.log('Done — login with admin / admin123');
  return p.\$disconnect();
}).catch((e) => { console.error(e); process.exit(1); });
"

echo "Restarting backend..."
docker compose up -d backend
sleep 5
docker compose ps backend
echo "Test login:"
curl -s -X POST http://127.0.0.1:\${HTTP_PORT:-8081}/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{\"username\":\"admin\",\"password\":\"admin123\"}' | head -c 200
echo
