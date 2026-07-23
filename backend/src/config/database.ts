import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e: any) => {
  logger.error('Prisma Error:', e);
});

prisma.$on('warn', (e: any) => {
  logger.warn('Prisma Warning:', e);
});

if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e: any) => {
    // logger.debug(`Query: ${e.query} - Duration: ${e.duration}ms`);
  });
}
