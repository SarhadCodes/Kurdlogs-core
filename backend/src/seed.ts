import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { TRANSCODING_PRESETS } from './config/constants';
import { logger } from './utils/logger';

const prisma = new PrismaClient();

function generateInitialAdminPassword(): string {
  // Meets password policy: 12+ chars, upper, lower, digit; no weak defaults.
  return `Kl-${randomBytes(10).toString('hex')}9A`;
}

async function main() {
  logger.info('Starting seed...');

  const adminExists = await prisma.user.findUnique({
    where: { username: 'admin' },
  });

  if (!adminExists) {
    const fromEnv = (process.env.ADMIN_INITIAL_PASSWORD || '').trim();
    const password = fromEnv.length >= 12 ? fromEnv : generateInitialAdminPassword();
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: true,
        mfaEnabled: false,
      },
    });

    logger.info('Created default admin user (username: admin)');
    logger.info('============================================================');
    logger.info(`INITIAL ADMIN PASSWORD: ${password}`);
    logger.info('Sign in, then change password and enable MFA immediately.');
    logger.info('============================================================');
  } else {
    logger.info('Admin user already exists');
  }

  const profilesCount = await prisma.transcodingProfile.count();
  if (profilesCount === 0) {
    for (const preset of TRANSCODING_PRESETS) {
      await prisma.transcodingProfile.create({
        data: {
          name: preset.name,
          resolution: preset.resolution as any,
          videoBitrate: preset.videoBitrate,
          audioBitrate: preset.audioBitrate,
          fps: preset.fps,
          isDefault: true,
        },
      });
    }
    logger.info('Created default transcoding profiles');
  } else {
    logger.info('Transcoding profiles already exist');
  }

  logger.info('Seed completed successfully');
}

main()
  .catch((e) => {
    logger.error('Error in seed script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
