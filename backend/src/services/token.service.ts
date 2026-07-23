import { prisma } from '../config/database';
import { generateToken } from '../utils/helpers';
import cron from 'node-cron';
import { env } from '../config/env';
import { getPublicBaseUrl } from '../config/publicUrl';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import {
  buildStablePlayUrl as buildStableStreamPlayUrl,
  buildTokenStreamUrl,
} from '../utils/streamUrls';

export interface IptvPlayInfo {
  channelId: string;
  channelSlug: string;
  channelName: string;
  token: string;
  previousToken: string | null;
  previousTokenValidUntil: string | null;
  expiresAt: string;
  refreshInSeconds: number;
  overlapSeconds: number;
  hlsUrl: string;
  dashUrl: string;
  stableHlsUrl: string;
  stableDashUrl: string;
}

class TokenService {
  private cronJob: cron.ScheduledTask | null = null;

  async hasActiveTokens(channelId: string): Promise<boolean> {
    const count = await prisma.token.count({
      where: {
        channelId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });
    return count > 0;
  }

  async getActiveTokenForChannel(channelId: string) {
    return prisma.token.findFirst({
      where: {
        channelId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: 'desc' },
    });
  }

  async createToken(channelId: string, refreshIntervalMinutes: number = 30) {
    const expiresAt = new Date(Date.now() + refreshIntervalMinutes * 60000);

    await prisma.token.updateMany({
      where: { channelId, isActive: true },
      data: { isActive: false, previousToken: null, previousTokenValidUntil: null },
    });

    return prisma.token.create({
      data: {
        channelId,
        token: generateToken(),
        expiresAt,
        refreshIntervalMinutes,
        isActive: true,
      },
      include: { channel: true },
    });
  }

  async deleteToken(id: string) {
    return prisma.token.delete({ where: { id } });
  }

  async getTokensForChannel(channelId: string) {
    return prisma.token.findMany({ where: { channelId } });
  }

  async getAllTokens() {
    return prisma.token.findMany({ include: { channel: true } });
  }

  async validateToken(channelSlug: string, token: string) {
    const channel = await prisma.channel.findUnique({ where: { slug: channelSlug } });
    if (!channel) return false;

    const now = new Date();
    const record = await prisma.token.findFirst({
      where: {
        channelId: channel.id,
        isActive: true,
        OR: [
          { token, expiresAt: { gt: now } },
          { previousToken: token, previousTokenValidUntil: { gt: now } },
        ],
      },
    });

    return !!record;
  }

  async refreshToken(id: string) {
    const tokenRecord = await prisma.token.findUnique({ where: { id } });
    if (!tokenRecord) throw new AppError('Token not found', 404);

    const expiresAt = new Date(Date.now() + tokenRecord.refreshIntervalMinutes * 60000);
    const newToken = generateToken();
    const overlapUntil = new Date(Date.now() + env.TOKEN_OVERLAP_SECONDS * 1000);

    return prisma.token.update({
      where: { id },
      data: {
        previousToken: tokenRecord.token,
        previousTokenValidUntil: overlapUntil,
        token: newToken,
        expiresAt,
        isActive: true,
      },
      include: { channel: true },
    });
  }

  async refreshAllExpiring() {
    const now = new Date();
    const aheadMs = env.TOKEN_REFRESH_AHEAD_SECONDS * 1000;

    const expiringTokens = await prisma.token.findMany({
      where: {
        isActive: true,
        expiresAt: { lte: new Date(now.getTime() + aheadMs) },
      },
      include: { channel: true },
    });

    for (const token of expiringTokens) {
      try {
        await this.refreshToken(token.id);
        logger.info(
          `Auto-refreshed token for channel ${token.channel?.name || token.channelId} (overlap ${env.TOKEN_OVERLAP_SECONDS}s)`
        );
      } catch (err) {
        logger.error(`Failed to auto-refresh token ${token.id}`, err);
      }
    }
  }

  startTokenRefreshCron() {
    if (this.cronJob) return;

    this.cronJob = cron.schedule('* * * * *', () => {
      this.refreshAllExpiring();
    });

    logger.info('Token refresh cron job started');
  }

  stopTokenRefreshCron() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  buildStablePlayUrl(slug: string, manifest: string): string {
    return buildStableStreamPlayUrl(getPublicBaseUrl(), slug, manifest, env.IPTV_API_KEY);
  }

  async getIptvPlayInfo(channel: { id: string; slug: string; name: string; outputType?: string }): Promise<IptvPlayInfo | null> {
    const record = await this.getActiveTokenForChannel(channel.id);
    if (!record) return null;

    const now = Date.now();
    const refreshInSeconds = Math.max(0, Math.floor((record.expiresAt.getTime() - now) / 1000));
    const manifest = channel.outputType === 'DASH' ? 'manifest.mpd' : 'index.m3u8';

    return {
      channelId: channel.id,
      channelSlug: channel.slug,
      channelName: channel.name,
      token: record.token,
      previousToken: record.previousToken,
      previousTokenValidUntil: record.previousTokenValidUntil?.toISOString() ?? null,
      expiresAt: record.expiresAt.toISOString(),
      refreshInSeconds,
      overlapSeconds: env.TOKEN_OVERLAP_SECONDS,
      hlsUrl: buildTokenStreamUrl(getPublicBaseUrl(), channel.slug, record.token, 'index.m3u8'),
      dashUrl: buildTokenStreamUrl(getPublicBaseUrl(), channel.slug, record.token, 'manifest.mpd'),
      stableHlsUrl: this.buildStablePlayUrl(channel.slug, 'index.m3u8'),
      stableDashUrl: this.buildStablePlayUrl(channel.slug, 'manifest.mpd'),
    };
  }

  async buildIptvChannelInfo(channel: { id: string; slug: string; name: string; status: string; outputType?: string }) {
    const play = await this.getIptvPlayInfo(channel);
    return {
      id: channel.id,
      slug: channel.slug,
      name: channel.name,
      status: channel.status,
      outputType: channel.outputType || 'HLS',
      hasToken: !!play,
      play,
    };
  }

  buildSecureUrl(channelSlug: string, tokenRecord: { token: string; expiresAt: Date }): string {
    const expires = Math.floor(tokenRecord.expiresAt.getTime() / 1000);
    return `${env.NGINX_HLS_URL}/${channelSlug}/index.m3u8?token=${tokenRecord.token}&expires=${expires}`;
  }
}

export const tokenService = new TokenService();
