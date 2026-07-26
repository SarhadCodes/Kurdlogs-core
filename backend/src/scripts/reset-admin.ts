import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

function generatePassword(): string {
  return `Kl-${randomBytes(10).toString('hex')}9A`;
}

async function main() {
  const password = (process.argv[2] || '').trim() || generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      passwordHash,
      mustChangePassword: true,
      role: 'ADMIN',
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: null,
    },
    create: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      mustChangePassword: true,
    },
  });
  logger.info(`Admin user ready: ${user.username}`);
  logger.info(`Password: ${password}`);
  logger.info('Change password and enable MFA after login.');
}

main()
  .catch((e) => {
    logger.error('reset-admin failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
