import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';import { logger } from '../utils/logger';

const prisma = new PrismaClient();

const DEFAULT_ADMIN_PASSWORD = 'Kurdlogs!';

function generatePassword(): string {
  return DEFAULT_ADMIN_PASSWORD;
}

async function main() {
  const password =
    (process.argv[2] || '').trim() ||
    (process.env.ADMIN_INITIAL_PASSWORD || '').trim() ||
    generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      passwordHash,
      mustChangePassword: false,
      role: 'ADMIN',
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: null,
    },
    create: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      mustChangePassword: false,
    },
  });
  logger.info(`Admin user ready: ${user.username}`);
  logger.info(`Password: ${password}`);
}

main()
  .catch((e) => {
    logger.error('reset-admin failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
