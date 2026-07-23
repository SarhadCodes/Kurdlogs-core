import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();
const password = process.argv[2] || 'admin123';

async function main() {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash, mustChangePassword: true, role: 'ADMIN' },
    create: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      mustChangePassword: true,
    },
  });
  logger.info(`Admin user ready: ${user.username} / ${password}`);
}

main()
  .catch((e) => {
    logger.error('reset-admin failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
