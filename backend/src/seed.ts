import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { TRANSCODING_PRESETS } from './config/constants';
import { logger } from './utils/logger';

const prisma = new PrismaClient();

async function main() {
  logger.info('Starting seed...');

  // Create default admin user
  const adminExists = await prisma.user.findUnique({
    where: { username: 'admin' }
  });

  if (!adminExists) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('admin123', salt);

    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: true
      }
    });
    logger.info('Created default admin user (admin / admin123)');
  } else {
    logger.info('Admin user already exists');
  }

  // Create default transcoding profiles
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
          isDefault: true
        }
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
