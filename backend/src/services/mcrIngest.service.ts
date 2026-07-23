import { prisma } from '../config/database';
import { env } from '../config/env';
import { buildMcrInternalIngestUrl, buildMcrPublicIngestUrl } from '../config/mcrRtmp';
import {
  getConfiguredRtmpApp,
  parseNginxApplicationNames,
  parseNginxStreams,
  resolveNginxRtmpApp,
} from '../config/nginxRtmpStat';
import { logger } from '../utils/logger';
import { probeRtmpPlayable } from '../utils/mcrRtmpProbe';
import { wsService } from './websocket.service';
import { sourceRouterService } from './sourceRouter.service';

export interface IngestPublisherView {
  streamKey: string;
  label: string | null;
  clientIp: string | null;
  active: boolean;
  bitrate: number;
  fps: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
  rtmpUrl: string;
  publishUrl: string;
  startedAt: string;
  lastSeenAt: string;
}

class McrIngestService {
  private pollTimer: NodeJS.Timeout | null = null;

  getInternalRtmpUrl(streamKey: string): string {
    return buildMcrInternalIngestUrl(streamKey);
  }

  getPublicPublishUrl(streamKey: string, host?: string): string {
    return buildMcrPublicIngestUrl(streamKey, host);
  }

  validateSecret(secret: string | undefined): boolean {
    return !!secret && secret === env.MCR_INGEST_SECRET;
  }

  startPoller(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollNginxStat();
    }, 8000);
    logger.info('[MCR_INGEST] RTMP publisher poller started');
  }

  stopPoller(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async handlePublish(streamKey: string, clientIp?: string, label?: string): Promise<void> {
    const key = this.normalizeKey(streamKey);
    if (!key || key.startsWith('mcr-')) return;

    await prisma.mcrIngestPublisher.upsert({
      where: { streamKey: key },
      create: {
        streamKey: key,
        label: label ?? `Ingest: ${key}`,
        clientIp: clientIp ?? null,
        active: true,
      },
      update: {
        active: true,
        clientIp: clientIp ?? undefined,
        lastSeenAt: new Date(),
      },
    });

    logger.info(`[MCR_INGEST] streamKey=${key} clientIp=${clientIp ?? 'unknown'} action=publish`);

    await this.syncIngestSourcesToRouters(key);
    await sourceRouterService.warmIngestSessions(key);
    wsService.emitMcrIngest({ event: 'publish', streamKey: key });
  }

  async handlePublishDone(streamKey: string): Promise<void> {
    const key = this.normalizeKey(streamKey);
    if (!key) return;

    await prisma.mcrIngestPublisher.updateMany({
      where: { streamKey: key },
      data: { active: false, lastSeenAt: new Date() },
    });

    logger.info(`[MCR_INGEST] streamKey=${key} action=publish_done`);

    await this.markIngestSourcesOffline(key);
    wsService.emitMcrIngest({ event: 'publish_done', streamKey: key });
  }

  private normalizeKey(name: string): string {
    return name.replace(/^\/+/, '').split('/').pop()?.trim() ?? name.trim();
  }

  async createIngestKey(label: string, streamKey?: string): Promise<IngestPublisherView> {
    const key = streamKey?.trim() || `ingest-${Date.now().toString(36)}`;
    const row = await prisma.mcrIngestPublisher.upsert({
      where: { streamKey: key },
      create: { streamKey: key, label, active: false },
      update: { label },
    });
    return this.toView(row);
  }

  async listPublishers(): Promise<IngestPublisherView[]> {
    const rows = await prisma.mcrIngestPublisher.findMany({ orderBy: { lastSeenAt: 'desc' } });
    return rows.map((r) => this.toView(r));
  }

  private toView(row: {
    streamKey: string;
    label: string | null;
    clientIp: string | null;
    active: boolean;
    bitrate: number | null;
    fps: number | null;
    width: number | null;
    height: number | null;
    hasAudio: boolean | null;
    startedAt: Date;
    lastSeenAt: Date;
  }): IngestPublisherView {
    return {
      streamKey: row.streamKey,
      label: row.label,
      clientIp: row.clientIp,
      active: row.active,
      bitrate: row.bitrate ?? 0,
      fps: row.fps ?? 0,
      width: row.width,
      height: row.height,
      hasAudio: row.hasAudio,
      rtmpUrl: this.getInternalRtmpUrl(row.streamKey),
      publishUrl: this.getPublicPublishUrl(row.streamKey),
      startedAt: row.startedAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  }

  /** Sync active ingest publishers into every enabled MCR router source list. */
  async syncIngestSourcesToRouters(streamKey?: string): Promise<void> {
    const publishers = await prisma.mcrIngestPublisher.findMany({
      where: streamKey ? { streamKey, active: true } : { active: true },
    });

    const routers = await prisma.mcrRouterState.findMany({
      where: { enabled: true },
      select: { channelId: true },
    });

    for (const router of routers) {
      for (const pub of publishers) {
        const existing = await prisma.mcrSource.findFirst({
          where: { routerChannelId: router.channelId, streamKey: pub.streamKey },
        });
        const inputUrl = this.getInternalRtmpUrl(pub.streamKey);
        const label = pub.label ?? `Ingest: ${pub.streamKey}`;

        if (existing) {
          await prisma.mcrSource.update({
            where: { id: existing.id },
            data: { inputUrl, label, enabled: true },
          });
        } else {
          const count = await prisma.mcrSource.count({
            where: { routerChannelId: router.channelId },
          });
          await prisma.mcrSource.create({
            data: {
              routerChannelId: router.channelId,
              label,
              sourceType: 'RTMP_INGEST',
              inputUrl,
              streamKey: pub.streamKey,
              isAutoDiscover: true,
              sortOrder: count,
            },
          });
        }
      }
      sourceRouterService.emitState(router.channelId);
    }
  }

  private async markIngestSourcesOffline(streamKey: string): Promise<void> {
    const sources = await prisma.mcrSource.findMany({
      where: { streamKey, sourceType: 'RTMP_INGEST' },
      select: { routerChannelId: true },
    });
    const routerIds = [...new Set(sources.map((s) => s.routerChannelId))];
    for (const routerChannelId of routerIds) {
      sourceRouterService.emitState(routerChannelId);
    }
  }

  private parseActiveStreamKeys(xml: string): string[] {
    return parseNginxStreams(xml)
      .filter((s) => s.bwIn > 0 || s.bwVideo > 0)
      .map((s) => s.streamName);
  }

  private async fetchNginxStatXml(): Promise<string | null> {
    try {
      const res = await fetch(`http://${env.NGINX_RTMP_HOST}:8080/stat`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  async getNginxStreamStat(
    streamKey: string
  ): Promise<{
    bwIn: number;
    bwVideo: number;
    fps: number;
    publishing: boolean;
    application: string;
    clientCount: number;
  } | null> {
    const xml = await this.fetchNginxStatXml();
    if (!xml) return null;
    const configuredApp = getConfiguredRtmpApp();
    const discoveredApps = parseNginxApplicationNames(xml);
    const resolvedApp = resolveNginxRtmpApp(configuredApp, discoveredApps);

    for (const stream of parseNginxStreams(xml)) {
      if (stream.application !== resolvedApp || stream.streamName !== streamKey) continue;
      logger.info(
        `[NGINX] app=${stream.application} streamKey=${stream.streamName} ` +
          `bitrate=${stream.bwIn} bwVideo=${stream.bwVideo} fps=${stream.fps} ` +
          `publishing=${stream.publishing} clients=${stream.clientCount} detected=registered`
      );
      return {
        bwIn: stream.bwIn,
        bwVideo: stream.bwVideo,
        fps: stream.fps,
        publishing: stream.publishing,
        application: stream.application,
        clientCount: stream.clientCount,
      };
    }
    logger.info(
      `[NGINX] app=${resolvedApp} streamKey=${streamKey} detected=missing ` +
        `configuredApp=${configuredApp}`
    );
    return null;
  }

  async fetchActiveStreamKeys(): Promise<string[]> {
    const xml = await this.fetchNginxStatXml();
    if (!xml) return [];
    return this.parseActiveStreamKeys(xml);
  }

  async isStreamPublishingWithMedia(streamKey: string): Promise<boolean> {
    const url = buildMcrInternalIngestUrl(streamKey);
    const stat = await this.getNginxStreamStat(streamKey);
    const statHint = !!(stat && (stat.bwIn > 0 || stat.bwVideo > 0 || stat.publishing));

    if (!statHint) {
      return probeRtmpPlayable(url, { context: `session-${streamKey}`, killAfterMs: 5000 });
    }

    return probeRtmpPlayable(url, {
      context: `session-stat-${streamKey}`,
      killAfterMs: 6000,
      rwTimeoutUs: 8_000_000,
    });
  }

  async isStreamPublishing(streamKey: string): Promise<boolean> {
    return this.isStreamPublishingWithMedia(streamKey);
  }

  /**
   * - Promotes newly-seen streams (webhook backup).
   * - Reconciles stale DB publishers: any publisher marked active but absent from the
   *   live stat for longer than the grace window is cleared (and its live encoder stopped).
   */
  async pollNginxStat(): Promise<void> {
    try {
      const STALE_GRACE_MS = 15_000;
      const xml = await this.fetchNginxStatXml();
      // If the stat endpoint is unreachable we cannot assert truth — skip reconciliation.
      if (xml == null) return;

      const liveKeys = this.parseActiveStreamKeys(xml).filter((k) => !k.startsWith('mcr-'));
      const activeSet = new Set(liveKeys);

      const known = await prisma.mcrIngestPublisher.findMany({
        where: { active: true },
      });
      const knownSet = new Set(known.map((k) => k.streamKey));

      for (const key of liveKeys) {
        if (!knownSet.has(key)) {
          await this.handlePublish(key);
        } else {
          await prisma.mcrIngestPublisher.update({
            where: { streamKey: key },
            data: { lastSeenAt: new Date() },
          });
          // Control Room removed — no per-channel live encoder reconciliation here.
        }
      }

      for (const row of known) {
        if (row.streamKey.startsWith('mcr-')) continue;
        if (activeSet.has(row.streamKey)) continue;
        const ageMs = Date.now() - row.lastSeenAt.getTime();
        if (ageMs < STALE_GRACE_MS) continue;

        // nginx /stat can lag or miss active publishers — confirm before tearing down.
        if (await this.isStreamPublishingWithMedia(row.streamKey)) {
          await prisma.mcrIngestPublisher.update({
            where: { streamKey: row.streamKey },
            data: { lastSeenAt: new Date() },
          });
          continue;
        }

        logger.info(
          `[MCR_INGEST] reconcile streamKey=${row.streamKey} — absent from RTMP stat for ${Math.round(
            ageMs / 1000
          )}s and probe confirms offline, marking inactive`
        );
        await this.handlePublishDone(row.streamKey);
      }
    } catch {
      /* nginx stat optional */
    }
  }
}

export const mcrIngestService = new McrIngestService();
