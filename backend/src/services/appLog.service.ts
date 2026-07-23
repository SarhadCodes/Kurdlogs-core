import { AppLogCategory, LogLevel, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

class AppLogService {
  async log(
    category: AppLogCategory,
    message: string,
    level: LogLevel = 'INFO',
    meta?: Record<string, unknown>
  ): Promise<void> {
    try {
      await prisma.appLog.create({
        data: {
          category,
          level,
          message,
          meta: meta ? (meta as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  async list(options?: {
    category?: AppLogCategory;
    limit?: number;
    since?: Date;
  }) {
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 1000);
    return prisma.appLog.findMany({
      where: {
        ...(options?.category ? { category: options.category } : {}),
        ...(options?.since ? { createdAt: { gte: options.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async exportJson(categories?: AppLogCategory[]): Promise<string> {
    const rows = await prisma.appLog.findMany({
      where: categories?.length ? { category: { in: categories } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const dir = path.join(env.UPLOADS_DIR, 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `app-logs-${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
    return filePath;
  }
}

export const appLogService = new AppLogService();
