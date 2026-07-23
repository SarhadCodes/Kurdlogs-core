import { prisma } from '../config/database';
import { McrRoutingMode, McrSourceType, Role } from '@prisma/client';
import { env } from '../config/env';
import { buildMcrRtmpUrl } from '../config/mcrRtmp';
import { logger } from '../utils/logger';
import { mcrRelayService, type McrRelayInput } from './mcrRelay.service';
import { mcrHealthService, type McrSourceHealth } from './mcrHealth.service';
import { wsService } from './websocket.service';
import { ffmpegService } from './ffmpeg.service';
import { mcrIngestService } from './mcrIngest.service';
import { mcrBusHolderService } from './mcrBusHolder.service';
import { mcrSourceSessionService } from './mcrSourceSession.service';
import { mcrMediaAuditService } from './mcrMediaAudit.service';
import { mcrBindingService } from './mcrBinding.service';
import { sleep } from '../utils/helpers';
import { buildMcrInternalIngestUrl } from '../config/mcrRtmp';
import { waitForRtmpPlayable, probeRtmpPlayable } from '../utils/mcrRtmpProbe';
import { getPublishedHlsManifest } from '../utils/streamPaths';
import { mcrSwitcherEngineService } from './mcr/mcrSwitcherEngine.service';
import { mcrProgramEncoderService } from './mcr/mcrProgramEncoder.service';
import { buildMcrSwitcherSourceUrl, isMcrSwitcherSourceUrl, parseMcrSwitcherChannelId } from './mcr/mcrSwitcherUrl';

export type McrTransition = 'TAKE' | 'CUT' | 'FADE' | 'AUTO';

export interface McrRouteOptions {
  transition?: McrTransition;
  fadeMs?: number;
}

export interface McrSourceView {
  id: string;
  label: string;
  sourceType: McrSourceType;
  refChannelId: string | null;
  inputUrl: string | null;
  streamKey: string | null;
  isAutoDiscover: boolean;
  enabled: boolean;
  sortOrder: number;
  health: McrSourceHealth;
  sessionActive: boolean;
  sessionUptimeSec: number;
  sessionStatus?: 'CONNECTING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  sessionMetrics?: {
    fps: number;
    bitrate: number;
    resolution: string | null;
    audioPresent: boolean;
    lastFrameAt: number | null;
    frozen: boolean;
  };
  previewUrl?: string | null; // sessionKey slug for HLS preview tap
}

export interface AddMcrSourceInput {
  label: string;
  sourceType: McrSourceType;
  inputUrl?: string;
  refChannelId?: string;
  streamKey?: string;
}

export interface McrRouterSnapshot {
  channelId: string;
  channelName: string;
  channelSlug: string;
  channelStatus: string;
  enabled: boolean;
  routingMode: McrRoutingMode;
  programSourceId: string | null;
  previewSourceId: string | null;
  automationSourceId: string | null;
  programSource: McrSourceView | null;
  previewSource: McrSourceView | null;
  automationSource: McrSourceView | null;
  sources: McrSourceView[];
  busRtmpUrl: string;
  relayRunning: boolean;
  relayUptimeSec: number;
  programStats: {
    bitrate: number;
    fps: number;
    uptime: number;
    resolution?: string;
  } | null;
  previewUrls: Record<string, string | null>;
  outputHealth?: {
    encoderOnline: boolean;
    lastSegmentAt: number | null;
    fps: number;
    bitrate: number;
  };
  /** v2 switcher architecture metadata */
  switcherRunning?: boolean;
  architectureVersion?: string;
}

class SourceRouterService {
  private isV2Switcher(): boolean {
    return env.MCR_ARCHITECTURE === 'v2-switcher';
  }

  private async audit(
    channelId: string,
    action: string,
    operator?: { id: string; username: string },
    details?: Record<string, unknown>
  ): Promise<void> {
    logger.info(
      `[${action}] channelId=${channelId} operator=${operator?.username ?? 'system'} ` +
        `details=${JSON.stringify(details ?? {})}`
    );
    await prisma.mcrAuditLog.create({
      data: {
        channelId,
        action,
        operatorId: operator?.id,
        operator: operator?.username,
        details: (details ?? undefined) as import('@prisma/client').Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async resolveRelayInput(source: {
    sourceType: McrSourceType;
    refChannelId: string | null;
    inputUrl: string | null;
    streamKey?: string | null;
  }): Promise<McrRelayInput | null> {
    if (source.sourceType === 'BLUEPRINT' || source.sourceType === 'PLAYLIST') {
      if (!source.refChannelId) return null;
      const ch = await prisma.channel.findUnique({
        where: { id: source.refChannelId },
        select: { slug: true },
      });
      if (!ch) return null;
      return mcrRelayService.resolveChannelHlsInput(ch.slug);
    }

    const url =
      source.sourceType === 'RTMP_INGEST' && source.streamKey
        ? mcrIngestService.getInternalRtmpUrl(source.streamKey)
        : source.inputUrl;

    if (!url) return null;

    switch (source.sourceType) {
      case 'RTMP':
      case 'RTMP_INGEST':
        return { url, kind: 'RTMP' };
      case 'SRT':
        return { url, kind: 'SRT' };
      case 'RTSP':
        return { url, kind: 'RTSP' };
      case 'HLS':
        return { url, kind: 'HLS_URL' };
      case 'MPEGTS':
        return { url, kind: 'MPEGTS' };
      case 'UDP':
        return { url, kind: 'UDP' };
      case 'EMERGENCY':
        return { url, kind: 'HLS_FILE' };
      default:
        return { url, kind: 'HTTP' };
    }
  }

  private buildPreviewManifestPath(sessionKey: string): string {
    return `/stream/${sessionKey}/index.m3u8`;
  }

  private async buildSourceView(
    source: Awaited<ReturnType<typeof prisma.mcrSource.findFirst>> & object
  ): Promise<McrSourceView> {
    const health = await mcrHealthService.checkSource(source);
    const sessionInfo = mcrSourceSessionService.getSessionInfo(source.routerChannelId, source.id);
    const metrics = mcrSourceSessionService.getSessionMetrics(source.routerChannelId, source.id);
    const sessionKey = mcrSourceSessionService.getSessionKey(source.routerChannelId, source.id);
    const running = mcrSourceSessionService.isRunning(source.routerChannelId, source.id);
    const previewUrl = running || metrics?.status === 'ONLINE' ? sessionKey : null;

    if (metrics) {
      health.fps = metrics.fps || health.fps;
      health.bitrate = metrics.bitrate || health.bitrate;
      health.resolution = metrics.resolution || health.resolution;
      health.hasAudio = metrics.audioPresent || health.hasAudio;
      if (metrics.frozen) health.status = 'DEGRADED';
      else if (metrics.status === 'ONLINE') health.status = 'ONLINE';
      else if (metrics.status === 'CONNECTING') health.status = 'DEGRADED';
    }

    return {
      id: source.id,
      label: source.label,
      sourceType: source.sourceType,
      refChannelId: source.refChannelId,
      inputUrl: source.inputUrl,
      streamKey: source.streamKey ?? null,
      isAutoDiscover: source.isAutoDiscover ?? false,
      enabled: source.enabled,
      sortOrder: source.sortOrder,
      health,
      sessionActive: mcrSourceSessionService.isRunning(source.routerChannelId, source.id),
      sessionUptimeSec: sessionInfo?.uptimeSec ?? 0,
      sessionStatus: sessionInfo?.status ?? metrics?.status ?? 'OFFLINE',
      sessionMetrics: metrics
        ? {
            fps: metrics.fps,
            bitrate: metrics.bitrate,
            resolution: metrics.resolution,
            audioPresent: metrics.audioPresent,
            lastFrameAt: metrics.lastFrameAt,
            frozen: metrics.frozen,
          }
        : undefined,
      previewUrl,
    };
  }

  async getSnapshot(channelId: string): Promise<McrRouterSnapshot | null> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        mcrRouter: { include: { sources: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!channel) return null;

    const router = channel.mcrRouter;
    const sources = router?.sources ?? [];
    const sourceViews = await Promise.all(sources.map((s) => this.buildSourceView(s)));

    const find = (id: string | null | undefined) =>
      id ? sourceViews.find((s) => s.id === id) ?? null : null;

    const proc = ffmpegService.getProcessInfo(channelId);
    const relay = mcrRelayService.getRelayInfo(channelId);
    const switcherRunning = mcrProgramEncoderService.isRunning(channelId);

    const previewUrls: Record<string, string | null> = {};
    for (const s of sourceViews) {
      previewUrls[s.id] = s.previewUrl ?? null;
    }

    return {
      channelId: channel.id,
      channelName: channel.name,
      channelSlug: channel.slug,
      channelStatus: channel.status,
      enabled: router?.enabled ?? false,
      routingMode: router?.routingMode ?? 'AUTOMATION',
      programSourceId: router?.programSourceId ?? null,
      previewSourceId: router?.previewSourceId ?? null,
      automationSourceId: router?.automationSourceId ?? null,
      programSource: find(router?.programSourceId),
      previewSource: find(router?.previewSourceId),
      automationSource: find(router?.automationSourceId),
      sources: sourceViews,
      busRtmpUrl: this.isV2Switcher()
        ? buildMcrSwitcherSourceUrl(channelId)
        : mcrRelayService.getBusRtmpUrl(channelId),
      relayRunning: this.isV2Switcher() ? switcherRunning : mcrRelayService.isRunning(channelId),
      relayUptimeSec: this.isV2Switcher()
        ? Math.floor(
            ((mcrProgramEncoderService.getState(channelId)?.startedAt ?? Date.now()) - Date.now()) /
              -1000
          )
        : relay?.uptimeSec ?? 0,
      switcherRunning,
      architectureVersion: router?.architectureVersion ?? env.MCR_ARCHITECTURE,
      programStats: proc
        ? {
            bitrate: proc.stats.bitrate ?? 0,
            fps: proc.stats.fps ?? 0,
            uptime: proc.stats.uptime ?? 0,
          }
        : null,
      previewUrls,
      outputHealth: proc
        ? {
            encoderOnline: proc.markedOnline,
            lastSegmentAt: proc.lastProgressTime || null,
            fps: proc.stats.fps ?? 0,
            bitrate: proc.stats.bitrate ?? 0,
          }
        : undefined,
    };
  }

  /** Warm persistent sessions when OBS/vMix starts publishing to an ingest key. */
  async warmIngestSessions(streamKey: string): Promise<void> {
    const sources = await prisma.mcrSource.findMany({
      where: { streamKey, sourceType: 'RTMP_INGEST', enabled: true },
      include: { router: true },
    });

    const routerIds = [...new Set(sources.map((s) => s.routerChannelId))];
    for (const routerChannelId of routerIds) {
      const router = sources.find((s) => s.routerChannelId === routerChannelId)?.router;
      if (!router?.enabled) continue;
      await this.syncSourceSessions(routerChannelId);
      logger.info(
        `[MCR_SOURCE_CONNECTED] action=ingest-auto-warm streamKey=${streamKey} ` +
          `routerChannelId=${routerChannelId} sources=${sources.filter((s) => s.routerChannelId === routerChannelId).length}`
      );
    }
  }

  async initRouter(channelId: string, operator?: { id: string; username: string }): Promise<McrRouterSnapshot> {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new Error('Channel not found');

    const busUrl = this.isV2Switcher()
      ? buildMcrSwitcherSourceUrl(channelId)
      : mcrRelayService.getBusRtmpUrl(channelId);

    let router = await prisma.mcrRouterState.findUnique({
      where: { channelId },
      include: { sources: true },
    });

    if (!router) {
      router = await prisma.mcrRouterState.create({
        data: { channelId, enabled: true },
        include: { sources: true },
      });
    } else if (!router.enabled) {
      router = await prisma.mcrRouterState.update({
        where: { channelId },
        data: { enabled: true },
        include: { sources: true },
      });
    }

    if (router.sources.length === 0) {
      await this.discoverSources(channelId);
      router = await prisma.mcrRouterState.findUniqueOrThrow({
        where: { channelId },
        include: { sources: { orderBy: { sortOrder: 'asc' } } },
      });
    }

    await prisma.channel.update({
      where: { id: channelId },
      data: {
        sourceUrl: busUrl,
        sourceType: this.isV2Switcher() ? 'HTTP' : 'RTMP',
        isPlaylistChannel: false,
        useBlueprint: false,
      },
    });

    const automationId =
      router.automationSourceId ??
      router.sources.find((s) => s.sourceType === 'BLUEPRINT')?.id ??
      router.sources[0]?.id ??
      null;

    if (automationId) {
      await prisma.mcrRouterState.update({
        where: { channelId },
        data: {
          automationSourceId: automationId,
          programSourceId: router.programSourceId ?? automationId,
          routingMode: 'AUTOMATION',
        },
      });
    }

    await this.syncSourceSessions(channelId);

    const programId =
      router.programSourceId ?? automationId ?? router.sources[0]?.id ?? null;
    if (programId && !this.isV2Switcher()) {
      const programSource = router.sources.find((s) => s.id === programId);
      if (programSource) {
        try {
          await this.routeProgramBusToSource(channelId, programSource);
        } catch (err) {
          logger.warn(`[MCR_INIT] channelId=${channelId} initial bus route failed: ${err}`);
        }
      }
    }

    await this.audit(channelId, 'MCR_INIT', operator, { busUrl });
    this.emitState(channelId);

    try {
      if (this.isV2Switcher()) {
        await mcrSwitcherEngineService.ensurePermanentOutput(channelId, programId);
        if (programId) {
          const programSource = router.sources.find((s) => s.id === programId);
          if (programSource) {
            await mcrSwitcherEngineService.switchProgramToSource(channelId, programId, {
              transition: 'CUT',
            });
          }
        }
      } else {
        await this.ensureProgramBus(channelId);
        await this.ensureMcrOutputPipeline(channelId);
        await mcrBindingService.assertProgramEncoderBound(channelId, 'initRouter');
      }
      const ch = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { slug: true, status: true },
      });
      if (ch) {
        logger.info(
          `[MCR_OUTPUT_ACTIVE] channelId=${channelId} slug=${ch.slug} status=${ch.status} ` +
            `outputUrl=/stream/${ch.slug}/master.m3u8 architecture=${env.MCR_ARCHITECTURE}`
        );
      }
    } catch (err) {
      logger.error(`[MCR_INIT] channelId=${channelId} binding failed: ${err}`);
      throw err;
    }

    const snap = await this.getSnapshot(channelId);
    if (!snap) throw new Error('Failed to load MCR snapshot');
    return snap;
  }

  async discoverSources(channelId: string): Promise<void> {
    const channels = await prisma.channel.findMany({
      where: { id: { not: channelId } },
      include: { blueprint: { select: { name: true } }, playlist: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const existing = await prisma.mcrSource.findMany({ where: { routerChannelId: channelId } });
    const existingRefs = new Set(existing.map((s) => s.refChannelId).filter(Boolean));
    const existingKeys = new Set(existing.map((s) => s.streamKey).filter(Boolean));
    const existingUrls = new Set(existing.map((s) => s.inputUrl).filter(Boolean));

    let order = existing.length;

    const upsertSource = async (data: {
      label: string;
      sourceType: McrSourceType;
      refChannelId?: string;
      inputUrl?: string;
      streamKey?: string;
      isAutoDiscover?: boolean;
    }) => {
      if (data.streamKey && existingKeys.has(data.streamKey)) return;
      if (data.refChannelId && existingRefs.has(data.refChannelId) && data.sourceType !== 'RTMP') {
        const dup = existing.find(
          (s) => s.refChannelId === data.refChannelId && s.sourceType === data.sourceType
        );
        if (dup) return;
      }
      if (data.inputUrl && existingUrls.has(data.inputUrl)) return;

      await prisma.mcrSource.create({
        data: {
          routerChannelId: channelId,
          label: data.label,
          sourceType: data.sourceType,
          refChannelId: data.refChannelId ?? null,
          inputUrl: data.inputUrl ?? null,
          streamKey: data.streamKey ?? null,
          isAutoDiscover: data.isAutoDiscover ?? true,
          sortOrder: order++,
        },
      });
      if (data.streamKey) existingKeys.add(data.streamKey);
      if (data.refChannelId) existingRefs.add(data.refChannelId);
      if (data.inputUrl) existingUrls.add(data.inputUrl);
    };

    for (const ch of channels) {
      const rtmpOutUrl = mcrIngestService.getInternalRtmpUrl(ch.slug);

      if (ch.useBlueprint) {
        await upsertSource({
          label: `Blueprint: ${ch.blueprint?.name ?? ch.name}`,
          sourceType: 'BLUEPRINT',
          refChannelId: ch.id,
        });
      } else if (ch.isPlaylistChannel) {
        await upsertSource({
          label: `Playlist: ${ch.playlist?.name ?? ch.name}`,
          sourceType: 'PLAYLIST',
          refChannelId: ch.id,
        });
      }

      await upsertSource({
        label: `RTMP Out: ${ch.name}`,
        sourceType: 'RTMP',
        inputUrl: rtmpOutUrl,
        streamKey: ch.slug,
        isAutoDiscover: true,
      });
    }

    await mcrIngestService.syncIngestSourcesToRouters();
    logger.info(`[MCR_DISCOVER] channelId=${channelId} autoSourcesRegistered=true`);
    await this.syncSourceSessions(channelId);
    if (this.isV2Switcher()) {
      const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
      await mcrProgramEncoderService.ensureRunning(
        channelId,
        router?.programInputSlot ?? 0
      );
    }
  }

  private async syncSourceSessions(channelId: string): Promise<void> {
    const router = await prisma.mcrRouterState.findUnique({
      where: { channelId },
      include: { sources: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!router?.enabled) return;
    await mcrSourceSessionService.syncRouterSessions(
      channelId,
      router.sources,
      (source) => this.resolveRelayInput(source)
    );
  }

  private async routeProgramBusToSource(
    channelId: string,
    source: {
      id: string;
      label: string;
      sourceType: McrSourceType;
      refChannelId: string | null;
      inputUrl: string | null;
      streamKey?: string | null;
    },
    options?: McrRouteOptions
  ): Promise<void> {
    if (this.isV2Switcher()) {
      if (
        options?.transition === 'AUTO' &&
        mcrSourceSessionService.isSourceFrozen(channelId, source.id)
      ) {
        logger.warn(
          `[MCR_SOURCE_FROZEN] action=block-auto channelId=${channelId} sourceId=${source.id}`
        );
        return;
      }
      await mcrSwitcherEngineService.switchProgramToSource(channelId, source.id, options);
      return;
    }

    if (
      options?.transition === 'AUTO' &&
      mcrSourceSessionService.isSourceFrozen(channelId, source.id)
    ) {
      logger.warn(
        `[MCR_SOURCE_FROZEN] action=block-auto channelId=${channelId} sourceId=${source.id} ` +
          `label=${source.label} — frozen source will not go to program on AUTO`
      );
      return;
    }

    if (mcrSourceSessionService.isSourceFrozen(channelId, source.id)) {
      logger.warn(
        `[MCR_SOURCE_FROZEN] channelId=${channelId} sourceId=${source.id} label=${source.label} ` +
          `manual-switch-allowed=true`
      );
    }

    const input = await this.resolveRelayInput(source);
    if (!input) throw new Error('Cannot resolve source input URL');

    await mcrSourceSessionService.ensureSession(channelId, source.id, input, source.label);
    const routeInput = await mcrSourceSessionService.resolveSessionRouteInput(
      channelId,
      source.id,
      15000
    );

    if (!routeInput) {
      logger.warn(
        `[MCR_ROUTING_CHANGED] action=session-unavailable channelId=${channelId} sourceId=${source.id} ` +
          `label=${source.label} — holding slate on bus`
      );
      await mcrRelayService.stopRelay(channelId, 'session-unavailable');
      if (!mcrBusHolderService.isHolding(channelId)) {
        await mcrBusHolderService.startSlate(channelId);
      }
      await this.waitForBusOnNginx(mcrRelayService.getBusStreamKey(channelId), 10000);
      return;
    }

    const sessionAlive = mcrSourceSessionService.isRunning(channelId, source.id);
    const fadeMs =
      options?.transition === 'FADE' || options?.transition === 'AUTO'
        ? (options.fadeMs ?? env.MCR_FADE_DURATION_MS)
        : 0;

    await mcrRelayService.routeBusToSession(
      channelId,
      source.id,
      routeInput,
      source.label,
      sessionAlive,
      { fadeMs }
    );

    const busKey = mcrRelayService.getBusStreamKey(channelId);
    const busUp = await this.waitForBusOnNginx(busKey, 15000);
    if (!busUp && !mcrRelayService.isRunning(channelId)) {
      logger.warn(
        `[MCR_BUS] relay-not-on-nginx channelId=${channelId} sourceId=${source.id} — restoring slate`
      );
      await mcrRelayService.stopRelay(channelId, 'relay-not-on-nginx');
      if (!mcrBusHolderService.isHolding(channelId)) {
        await mcrBusHolderService.startSlate(channelId);
      }
      await this.waitForBusOnNginx(busKey, 10000);
    } else if (!busUp && mcrRelayService.isRunning(channelId)) {
      logger.info(
        `[MCR_BUS] relay-alive channelId=${channelId} ffprobe/stat inconclusive — keeping relay pid=${mcrRelayService.getRelayInfo(channelId)?.pid}`
      );
    }

    // Stop slate only after relay (or slate fallback) is confirmed on nginx.
    if (mcrRelayService.isRunning(channelId) && busUp) {
      await mcrBusHolderService.stopSlate(channelId);
    }

    logger.info(
      `[MCR_PROGRAM_BUS_SOURCE] channelId=${channelId} sourceId=${source.id} ` +
        `label=${source.label} routeKind=${routeInput.kind} routeUrl=${routeInput.url.slice(0, 120)} ` +
        `bus=${mcrRelayService.getBusRtmpUrl(channelId)} relayRunning=${mcrRelayService.isRunning(channelId)}`
    );
  }

  /**
   * Ensure the program encoder reads from the MCR bus — never blueprint/playlist direct.
   */
  async ensureMcrOutputPipeline(channelId: string): Promise<void> {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!channel || !router?.enabled) return;

    if (this.isV2Switcher()) {
      await mcrSwitcherEngineService.ensurePermanentOutput(
        channelId,
        router.programSourceId
      );
      const proc = ffmpegService.getProcessInfo(channelId);
      if (!proc) {
        logger.info(
          `[MCR_OUTPUT_ACTIVE] action=start-switcher-encoder channelId=${channelId} slug=${channel.slug}`
        );
        const { channelService } = await import('./channel.service');
        await channelService.startChannel(channelId);
      }
      return;
    }

    const busUrl = mcrRelayService.getBusRtmpUrl(channelId);
    await this.migrateMcrChannelSourceUrl(channelId);
    const needsConfigFix =
      channel.sourceUrl !== busUrl ||
      this.isLegacyMcrBusUrl(channel.sourceUrl, channelId) ||
      channel.isPlaylistChannel ||
      channel.useBlueprint;

    if (needsConfigFix) {
      await prisma.channel.update({
        where: { id: channelId },
        data: {
          sourceUrl: busUrl,
          sourceType: 'RTMP',
          isPlaylistChannel: false,
          useBlueprint: false,
        },
      });
      logger.info(
        `[MCR_OUTPUT_SOURCE] action=config-fixed channelId=${channelId} ` +
          `outputSource=${busUrl} clearedBlueprint=${channel.useBlueprint}`
      );
    }

    const proc = ffmpegService.getProcessInfo(channelId);
    const bypassing =
      proc?.playbackSource === 'BLUEPRINT' || proc?.playbackSource === 'PLAYLIST';

    if (!proc) {
      logger.info(
        `[MCR_OUTPUT_ACTIVE] action=start-encoder channelId=${channelId} slug=${channel.slug} ` +
          `outputUrl=/stream/${channel.slug}/master.m3u8 bus=${busUrl}`
      );
      const { channelService } = await import('./channel.service');
      await channelService.startChannel(channelId);
      await mcrBindingService.assertProgramEncoderBound(channelId, 'ensureMcrOutputPipeline');
      return;
    }

    if (bypassing) {
      logger.warn(
        `[MCR_OUTPUT_SOURCE] action=restart-encoder-bypass channelId=${channelId} ` +
          `encoderMode=${proc.playbackSource} — blueprint/playlist was bypassing MCR bus`
      );
      const { channelService } = await import('./channel.service');
      await channelService.restartChannel(channelId);
      await mcrBindingService.assertProgramEncoderBound(channelId, 'ensureMcrOutputPipeline-restart');
      return;
    }

    await mcrBindingService.auditBinding(channelId, 'ensureMcrOutputPipeline');
  }

  private async logMcrRoutingAudit(
    channelId: string,
    opts: {
      transition: string;
      oldProgramSourceId?: string | null;
      newProgramSourceId?: string | null;
    }
  ): Promise<void> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true, sourceUrl: true, status: true },
    });
    const relay = mcrRelayService.getRelayInfo(channelId);
    const proc = ffmpegService.getProcessInfo(channelId);
    const programBusSource = this.isV2Switcher()
      ? opts.newProgramSourceId ?? 'none'
      : relay?.routedSourceId ?? 'none';
    const outputSource = channel?.sourceUrl ?? 'unknown';
    const encoderMode = proc?.playbackSource ?? (proc ? proc.inputType : 'stopped');
    const viewerEndpoint = `/stream/${channel?.slug ?? 'unknown'}/master.m3u8`;
    const aligned = this.isV2Switcher()
      ? proc?.playbackSource === 'MCR_SWITCHER' && mcrProgramEncoderService.isRunning(channelId)
      : programBusSource === (opts.newProgramSourceId ?? programBusSource) &&
        outputSource.includes(`mcr-${channelId}`) &&
        encoderMode !== 'BLUEPRINT' &&
        encoderMode !== 'PLAYLIST';

    logger.info(
      `[MCR_OUTPUT_SOURCE] channelId=${channelId} outputSource=${outputSource} ` +
        `encoderStatus=${channel?.status ?? 'unknown'} encoderMode=${encoderMode} ` +
        `encoderPid=${proc?.pid ?? 'none'} viewerEndpoint=${viewerEndpoint}`
    );
    logger.info(
      `[MCR_ROUTING_CHANGED] channelId=${channelId} transition=${opts.transition} ` +
        `oldProgramSource=${opts.oldProgramSourceId ?? 'null'} ` +
        `newProgramSource=${opts.newProgramSourceId ?? 'null'} ` +
        `programBusSource=${programBusSource} outputSource=${outputSource} ` +
        `viewerEndpoint=${viewerEndpoint} aligned=${aligned}`
    );

    if (!aligned) {
      logger.warn(
        `[MCR_OUTPUT_SOURCE] action=misaligned channelId=${channelId} ` +
          `programBusSource=${programBusSource} newProgramSource=${opts.newProgramSourceId ?? 'null'} ` +
          `encoderMode=${encoderMode} — viewer output may not match program bus`
      );
    }

    if (channel?.slug) {
      void mcrMediaAuditService.auditChannel(channelId, channel.slug, opts.transition);
    }
  }

  private async finalizeMcrSwitch(
    channelId: string,
    opts: {
      transition: string;
      oldProgramSourceId?: string | null;
      newProgramSourceId?: string | null;
    }
  ): Promise<void> {
    if (!this.isV2Switcher()) {
      await this.ensureMcrOutputPipeline(channelId);
      await mcrBindingService.assertProgramEncoderBound(channelId, opts.transition);
    }
    await this.logMcrRoutingAudit(channelId, opts);
    if (!this.isV2Switcher()) {
      await mcrBindingService.logTakeResult(
        channelId,
        opts.oldProgramSourceId,
        opts.newProgramSourceId
      );
    }
  }

  validateSourceInput(input: AddMcrSourceInput): void {
    const { sourceType, inputUrl, refChannelId } = input;
    if (sourceType === 'NDI') {
      throw new Error('NDI support is planned for a future release');
    }
    if (sourceType === 'BLUEPRINT' || sourceType === 'PLAYLIST') {
      if (!refChannelId) throw new Error('Channel reference required');
      return;
    }
    if (!inputUrl?.trim()) throw new Error('Input URL required');
    const url = inputUrl.trim();
    if (sourceType === 'RTMP' && !url.startsWith('rtmp://')) {
      throw new Error('RTMP URL must start with rtmp://');
    }
    if (sourceType === 'SRT' && !url.startsWith('srt://')) {
      throw new Error('SRT URL must start with srt://');
    }
    if (sourceType === 'RTSP' && !url.startsWith('rtsp://')) {
      throw new Error('RTSP URL must start with rtsp://');
    }
    if (sourceType === 'HLS' && !url.includes('.m3u8')) {
      throw new Error('HLS URL should include .m3u8');
    }
    if (sourceType === 'MPEGTS' && !url.match(/\.ts($|\?)/i) && !url.startsWith('http')) {
      throw new Error('MPEG-TS URL should be a .ts stream or HTTP URL');
    }
    if (sourceType === 'UDP' && !url.startsWith('udp://')) {
      throw new Error('UDP URL must start with udp://');
    }
  }

  async addSource(
    channelId: string,
    input: AddMcrSourceInput,
    operator?: { id: string; username: string }
  ): Promise<McrSourceView> {
    this.validateSourceInput(input);

    let router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!router) {
      router = await prisma.mcrRouterState.create({ data: { channelId, enabled: false } });
    }

    const count = await prisma.mcrSource.count({ where: { routerChannelId: channelId } });
    const source = await prisma.mcrSource.create({
      data: {
        routerChannelId: channelId,
        label: input.label.trim(),
        sourceType: input.sourceType,
        refChannelId: input.refChannelId ?? null,
        inputUrl: input.inputUrl?.trim() ?? null,
        streamKey: input.streamKey ?? null,
        isAutoDiscover: false,
        sortOrder: count,
      },
    });

    const health = await mcrHealthService.checkSource(source);
    await this.audit(channelId, 'MCR_SOURCE_ADD', operator, {
      sourceId: source.id,
      label: input.label,
      sourceType: input.sourceType,
      status: health.status,
    });

    if (router?.enabled) {
      const relayInput = await this.resolveRelayInput(source);
      if (relayInput) {
        await mcrSourceSessionService.ensureSession(channelId, source.id, relayInput, source.label);
      }
      if (this.isV2Switcher()) {
        await mcrProgramEncoderService.ensureRunning(channelId);
      }
    }

    this.emitState(channelId);
    wsService.emitMcrSourcesUpdated(channelId);
    return this.buildSourceView(source);
  }

  async addRtmpSource(
    channelId: string,
    label: string,
    inputUrl: string,
    operator?: { id: string; username: string }
  ): Promise<McrSourceView> {
    return this.addSource(
      channelId,
      { label, sourceType: 'RTMP', inputUrl },
      operator
    );
  }

  async setPreview(
    channelId: string,
    sourceId: string,
    operator?: { id: string; username: string }
  ): Promise<McrRouterSnapshot> {
    const source = await prisma.mcrSource.findFirst({
      where: { id: sourceId, routerChannelId: channelId, enabled: true },
    });
    if (!source) throw new Error('Source not found');

    const relayInput = await this.resolveRelayInput(source);
    if (relayInput) {
      await mcrSourceSessionService.ensureSession(channelId, source.id, relayInput, source.label);
    }

    const sessionKey = mcrSourceSessionService.getSessionKey(channelId, sourceId);
    logger.info(
      `[MCR_PREVIEW_ASSIGNED] channelId=${channelId} sourceId=${sourceId} ` +
        `sessionKey=${sessionKey} label=${source.label} ` +
        `sessionActive=${mcrSourceSessionService.isRunning(channelId, sourceId)}`
    );
    logger.info(
      `[MCR_PREVIEW_ACTIVE] channelId=${channelId} sourceId=${sourceId} label=${source.label} ` +
        `previewUrl=${this.buildPreviewManifestPath(sessionKey)} sessionReuse=true`
    );

    await prisma.mcrRouterState.update({
      where: { channelId },
      data: { previewSourceId: sourceId },
    });

    if (this.isV2Switcher()) {
      await mcrSwitcherEngineService.executePreview(channelId, sourceId);
    }

    await this.audit(channelId, 'MCR_PREVIEW', operator, { sourceId, label: source.label });
    this.emitState(channelId);
    const snap = await this.getSnapshot(channelId);
    if (!snap) throw new Error('Channel not found');
    return snap;
  }

  async takeSource(
    channelId: string,
    operator?: { id: string; username: string },
    transition: McrTransition = 'TAKE',
    fadeDurationMs?: number
  ): Promise<McrRouterSnapshot> {
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!router?.enabled) throw new Error('MCR not enabled for this channel');
    if (!router.previewSourceId) {
      throw new Error('No preview source — double-click or drag a source to preview first');
    }

    const newProgramId = router.previewSourceId;
    const newPreviewId = router.programSourceId;

    const source = await prisma.mcrSource.findFirst({
      where: { id: newProgramId, routerChannelId: channelId, enabled: true },
    });
    if (!source) throw new Error('Preview source not found');

    const fadeMs =
      transition === 'FADE' ? (fadeDurationMs ?? env.MCR_FADE_DURATION_MS) : 0;

    await this.routeProgramBusToSource(channelId, source, { transition, fadeMs });

    await prisma.mcrRouterState.update({
      where: { channelId },
      data: {
        programSourceId: newProgramId,
        previewSourceId: newPreviewId,
        routingMode: 'MANUAL',
        relayPid: this.isV2Switcher()
          ? mcrProgramEncoderService.getState(channelId)?.process.pid ?? null
          : mcrRelayService.getRelayInfo(channelId)?.pid ?? null,
      },
    });

    logger.info(
      `[MCR_TAKE] channelId=${channelId} newProgram=${newProgramId} ` +
        `newPreview=${newPreviewId ?? 'null'} transition=${transition} fadeMs=${fadeMs} swap=true`
    );
    logger.info(
      `[MCR_PROGRAM_ASSIGNED] channelId=${channelId} sourceId=${newProgramId} label=${source.label}`
    );
    logger.info(
      `[MCR_PROGRAM_ACTIVE] channelId=${channelId} sourceId=${newProgramId} label=${source.label} ` +
        `transition=${transition} encoderRestart=false busRouteOnly=true`
    );
    if (newPreviewId) {
      logger.info(`[MCR_PREVIEW_ASSIGNED] channelId=${channelId} sourceId=${newPreviewId} via=take-swap`);
    }
    logger.info(
      `[MCR_ROUTING_CHANGED] channelId=${channelId} busSourceId=${newProgramId} ` +
        `transition=${transition} swap=true busRouteOnly=true`
    );

    await this.audit(channelId, 'MCR_TAKE', operator, {
      sourceId: newProgramId,
      label: source.label,
      sourceType: source.sourceType,
      transition,
      fadeMs,
      swap: true,
      previousProgramId: router.programSourceId,
      newPreviewId,
      busRouteOnly: true,
      sourceSessionPreserved: true,
    });

    await this.finalizeMcrSwitch(channelId, {
      transition,
      oldProgramSourceId: router.programSourceId,
      newProgramSourceId: newProgramId,
    });

    this.emitState(channelId);
    const snap = await this.getSnapshot(channelId);
    if (!snap) throw new Error('Channel not found');
    return snap;
  }

  async cutSource(
    channelId: string,
    sourceId: string | undefined,
    operator?: { id: string; username: string }
  ): Promise<McrRouterSnapshot> {
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!router?.enabled) throw new Error('MCR not enabled for this channel');

    const targetId = sourceId ?? router.previewSourceId;
    if (!targetId) {
      throw new Error('No source to cut — load preview or specify sourceId');
    }

    const source = await prisma.mcrSource.findFirst({
      where: { id: targetId, routerChannelId: channelId, enabled: true },
    });
    if (!source) throw new Error('Source not found');

    await this.routeProgramBusToSource(channelId, source, { transition: 'CUT' });

    await prisma.mcrRouterState.update({
      where: { channelId },
      data: {
        programSourceId: targetId,
        routingMode: 'MANUAL',
        relayPid: this.isV2Switcher()
          ? mcrProgramEncoderService.getState(channelId)?.process.pid ?? null
          : mcrRelayService.getRelayInfo(channelId)?.pid ?? null,
      },
    });

    logger.info(
      `[MCR_CUT] channelId=${channelId} sourceId=${targetId} label=${source.label} ` +
        `fromPreview=${!sourceId} swap=false`
    );
    logger.info(
      `[MCR_PROGRAM_ASSIGNED] channelId=${channelId} sourceId=${targetId} label=${source.label}`
    );
    logger.info(
      `[MCR_PROGRAM_ACTIVE] channelId=${channelId} sourceId=${targetId} label=${source.label} ` +
        `transition=CUT encoderRestart=false busRouteOnly=true`
    );
    logger.info(
      `[MCR_ROUTING_CHANGED] channelId=${channelId} busSourceId=${targetId} ` +
        `transition=CUT swap=false busRouteOnly=true`
    );

    await this.audit(channelId, 'MCR_CUT', operator, {
      sourceId: targetId,
      label: source.label,
      sourceType: source.sourceType,
      transition: 'CUT',
      fromPreview: !sourceId,
      busRouteOnly: true,
      sourceSessionPreserved: true,
    });

    await this.finalizeMcrSwitch(channelId, {
      transition: 'CUT',
      oldProgramSourceId: router.programSourceId,
      newProgramSourceId: targetId,
    });

    this.emitState(channelId);
    const snap = await this.getSnapshot(channelId);
    if (!snap) throw new Error('Channel not found');
    return snap;
  }

  async autoReturn(
    channelId: string,
    operator?: { id: string; username: string },
    fadeDurationMs?: number
  ): Promise<McrRouterSnapshot> {
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!router?.automationSourceId) throw new Error('No automation source configured');

    const source = await prisma.mcrSource.findFirst({
      where: { id: router.automationSourceId, routerChannelId: channelId, enabled: true },
    });
    if (!source) throw new Error('Automation source not found');

    const fadeMs = fadeDurationMs ?? env.MCR_FADE_DURATION_MS;

    await this.routeProgramBusToSource(channelId, source, { transition: 'AUTO', fadeMs });

    await prisma.mcrRouterState.update({
      where: { channelId },
      data: {
        programSourceId: router.automationSourceId,
        routingMode: 'AUTOMATION',
        relayPid: this.isV2Switcher()
          ? mcrProgramEncoderService.getState(channelId)?.process.pid ?? null
          : mcrRelayService.getRelayInfo(channelId)?.pid ?? null,
      },
    });

    logger.info(
      `[MCR_AUTO] channelId=${channelId} sourceId=${router.automationSourceId} ` +
        `label=${source.label} fadeMs=${fadeMs}`
    );
    logger.info(
      `[MCR_PROGRAM_ASSIGNED] channelId=${channelId} sourceId=${router.automationSourceId} label=${source.label}`
    );
    logger.info(
      `[MCR_PROGRAM_ACTIVE] channelId=${channelId} sourceId=${router.automationSourceId} label=${source.label} ` +
        `transition=AUTO encoderRestart=false busRouteOnly=true`
    );
    logger.info(
      `[MCR_ROUTING_CHANGED] channelId=${channelId} busSourceId=${router.automationSourceId} ` +
        `transition=AUTO fadeMs=${fadeMs} busRouteOnly=true`
    );

    await this.audit(channelId, 'MCR_AUTO', operator, {
      sourceId: router.automationSourceId,
      label: source.label,
      sourceType: source.sourceType,
      transition: 'AUTO',
      fadeMs,
      busRouteOnly: true,
      sourceSessionPreserved: true,
    });

    await this.finalizeMcrSwitch(channelId, {
      transition: 'AUTO',
      oldProgramSourceId: router.programSourceId,
      newProgramSourceId: router.automationSourceId,
    });

    this.emitState(channelId);
    const snap = await this.getSnapshot(channelId);
    if (!snap) throw new Error('Channel not found');
    return snap;
  }

  private async applyProgramSource(
    channelId: string,
    sourceId: string,
    transition: McrTransition,
    operator?: { id: string; username: string },
    fadeDurationMs?: number
  ): Promise<McrRouterSnapshot> {
    const source = await prisma.mcrSource.findFirst({
      where: { id: sourceId, routerChannelId: channelId, enabled: true },
    });
    if (!source) throw new Error('Source not found');

    const fadeMs =
      transition === 'FADE' || transition === 'AUTO'
        ? (fadeDurationMs ?? env.MCR_FADE_DURATION_MS)
        : 0;

    await this.routeProgramBusToSource(channelId, source, { transition, fadeMs });

    await prisma.mcrRouterState.update({
      where: { channelId },
      data: {
        programSourceId: sourceId,
        routingMode: transition === 'AUTO' ? 'AUTOMATION' : 'MANUAL',
        relayPid: this.isV2Switcher()
          ? mcrProgramEncoderService.getState(channelId)?.process.pid ?? null
          : mcrRelayService.getRelayInfo(channelId)?.pid ?? null,
      },
    });

    const action =
      transition === 'AUTO'
        ? 'MCR_AUTO'
        : transition === 'CUT'
          ? 'MCR_CUT'
          : transition === 'FADE'
            ? 'MCR_FADE'
            : 'MCR_TAKE';

    logger.info(
      `[${action}] channelId=${channelId} sourceId=${sourceId} label=${source.label} fadeMs=${fadeMs}`
    );
    logger.info(
      `[MCR_PROGRAM_ASSIGNED] channelId=${channelId} sourceId=${sourceId} label=${source.label}`
    );
    logger.info(
      `[MCR_ROUTING_CHANGED] channelId=${channelId} busSourceId=${sourceId} ` +
        `transition=${transition} busRouteOnly=true`
    );

    await this.audit(channelId, action, operator, {
      sourceId,
      label: source.label,
      sourceType: source.sourceType,
      transition,
      busRouteOnly: true,
      sourceSessionPreserved: true,
      blueprintUntouched: source.sourceType === 'BLUEPRINT',
    });

    this.emitState(channelId);
    const snap = await this.getSnapshot(channelId);
    if (!snap) throw new Error('Channel not found');
    return snap;
  }

  async emergencyTake(
    channelId: string,
    operator?: { id: string; username: string }
  ): Promise<McrRouterSnapshot> {
    let emergency = await prisma.mcrSource.findFirst({
      where: { routerChannelId: channelId, sourceType: 'EMERGENCY', enabled: true },
    });

    if (!emergency) {
      emergency = await prisma.mcrSource.create({
        data: {
          routerChannelId: channelId,
          label: 'Emergency Loop',
          sourceType: 'EMERGENCY',
          inputUrl: '',
          sortOrder: 999,
          enabled: false,
        },
      });
      throw new Error('Emergency source not configured — add a standby video URL first');
    }

    return this.applyProgramSource(channelId, emergency.id, 'CUT', operator);
  }

  getPreviewPlaybackUrl(source: McrSourceView, baseUrl: string): string | null {
    if (source.sourceType === 'BLUEPRINT' || source.sourceType === 'PLAYLIST') {
      if (!source.refChannelId) return null;
      return null; // resolved client-side via channel slug
    }
    if (source.sourceType === 'HLS' && source.inputUrl) {
      return source.inputUrl;
    }
    return null;
  }

  async ensureSourceSession(channelId: string, sourceId: string): Promise<string | null> {
    const source = await prisma.mcrSource.findFirst({
      where: { id: sourceId, routerChannelId: channelId, enabled: true },
    });
    if (!source) return null;
    const input = await this.resolveRelayInput(source);
    if (!input) return null;
    return mcrSourceSessionService.ensureSession(channelId, sourceId, input, source.label);
  }

  getPreviewSessionUrl(channelId: string, sourceId: string): string {
    const slug = mcrSourceSessionService.getSessionPreviewSlug(channelId, sourceId);
    const manifest = getPublishedHlsManifest(slug) ?? 'index.m3u8';
    return `/stream/${slug}/${manifest}`;
  }

  async retryProgramBusRoute(channelId: string, sourceId: string): Promise<void> {
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!router?.enabled) return;
    if (router.programSourceId !== sourceId && router.automationSourceId !== sourceId) return;

    const source = await prisma.mcrSource.findFirst({
      where: { id: sourceId, routerChannelId: channelId, enabled: true },
    });
    if (!source) return;

    const ready = await mcrSourceSessionService.waitForPublisher(channelId, sourceId, 8000);
    if (!ready) return;

    logger.info(
      `[MCR_BUS_ROUTE] action=session-ready-reroute channelId=${channelId} sourceId=${sourceId}`
    );
    await this.routeProgramBusToSource(channelId, source);
  }

  emitState(channelId: string): void {
    void this.getSnapshot(channelId).then((snap) => {
      if (snap) wsService.emitMcrState(channelId, snap as unknown as Record<string, unknown>);
    });
  }

  canControl(role: Role): boolean {
    return role === 'ADMIN' || role === 'SUPERVISOR' || role === 'OPERATOR';
  }

  async isMcrEnabledChannel(channelId: string): Promise<boolean> {
    const router = await prisma.mcrRouterState.findUnique({
      where: { channelId },
      select: { enabled: true },
    });
    return router?.enabled === true;
  }

  isLegacyMcrBusUrl(sourceUrl: string, channelId: string): boolean {
    if (!sourceUrl.includes(`mcr-${channelId}`)) return false;
    return /:1935(\/|:)/.test(sourceUrl) || /\/internal\//i.test(sourceUrl);
  }

  isMcrBusUrl(sourceUrl: string): boolean {
    if (this.isLegacyMcrBusUrl(sourceUrl, '')) return false;
    return new RegExp(`:${env.MCR_RTMP_PORT}/live/mcr-[0-9a-f-]+`, 'i').test(sourceUrl);
  }

  isMcrBusChannel(channelId: string, sourceUrl: string): boolean {
    if (isMcrSwitcherSourceUrl(sourceUrl)) {
      return parseMcrSwitcherChannelId(sourceUrl) === channelId;
    }
    if (sourceUrl.includes(`mcr-${channelId}`)) {
      if (this.isLegacyMcrBusUrl(sourceUrl, channelId)) return true;
      return this.isMcrBusUrl(sourceUrl);
    }
    return false;
  }

  /** Rewrite stale 1935/internal bus URLs to rtmp://nginx-rtmp:1936/live/mcr-{id}. */
  async migrateMcrChannelSourceUrl(channelId: string): Promise<string | null> {
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!router?.enabled) return null;

    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) return null;

    const busUrl = this.isV2Switcher()
      ? buildMcrSwitcherSourceUrl(channelId)
      : mcrRelayService.getBusRtmpUrl(channelId);
    const legacy = this.isLegacyMcrBusUrl(channel.sourceUrl, channelId);
    const wrong =
      channel.sourceUrl !== busUrl ||
      legacy ||
      channel.isPlaylistChannel ||
      channel.useBlueprint;

    if (!wrong) return busUrl;

    const oldUrl = channel.sourceUrl;
    await prisma.channel.update({
      where: { id: channelId },
      data: {
        sourceUrl: busUrl,
        sourceType: this.isV2Switcher() ? 'HTTP' : 'RTMP',
        isPlaylistChannel: false,
        useBlueprint: false,
      },
    });

    logger.info(
      `[MCR_RTMP_MIGRATE] channelId=${channelId} slug=${channel.slug} ` +
        `oldSourceUrl=${oldUrl.slice(0, 120)} newSourceUrl=${busUrl}`
    );
    return busUrl;
  }

  async migrateAllEnabledMcrChannels(): Promise<void> {
    const routers = await prisma.mcrRouterState.findMany({
      where: { enabled: true },
      select: { channelId: true },
    });
    for (const router of routers) {
      await this.migrateMcrChannelSourceUrl(router.channelId);
    }
    if (routers.length > 0) {
      logger.info(`[MCR_RTMP_MIGRATE] migrated=${routers.length} enabled MCR channel(s) to port ${env.MCR_RTMP_PORT}/live`);
    }
  }

  /**
   * Program encoder pulls rtmp://nginx-rtmp:1936/live/mcr-{id} — a publisher must exist first.
   * Bootstraps slate on nginx, then routes program source if configured.
   */
  async ensureProgramBus(channelId: string): Promise<{ mode: 'relay' | 'slate'; sourceLabel?: string }> {
    if (this.isV2Switcher()) {
      const router = await prisma.mcrRouterState.findUnique({
        where: { channelId },
        include: { sources: true },
      });
      if (!router?.enabled) {
        throw new Error(
          'MCR is not enabled for this channel. Open Control Room and click Enable MCR first.'
        );
      }
      await mcrSwitcherEngineService.ensurePermanentOutput(
        channelId,
        router.programSourceId ?? router.automationSourceId
      );
      const sourceId =
        router.programSourceId ?? router.automationSourceId ?? router.sources[0]?.id ?? null;
      const source = sourceId ? router.sources.find((s) => s.id === sourceId) : undefined;
      return { mode: 'relay', sourceLabel: source?.label };
    }

    const router = await prisma.mcrRouterState.findUnique({
      where: { channelId },
      include: { sources: true },
    });
    if (!router?.enabled) {
      throw new Error(
        'MCR is not enabled for this channel. Open Control Room and click Enable MCR first.'
      );
    }

    const busKey = mcrRelayService.getBusStreamKey(channelId);
    await this.ensureBusPublisherOnNginx(channelId);

    const sourceId =
      router.programSourceId ?? router.automationSourceId ?? router.sources[0]?.id ?? null;

    let sourceLabel: string | undefined;
    let mode: 'relay' | 'slate' = mcrRelayService.isRunning(channelId) ? 'relay' : 'slate';

    if (sourceId) {
      const source = router.sources.find((s) => s.id === sourceId);
      if (source) {
        sourceLabel = source.label;
        try {
          await this.routeProgramBusToSource(channelId, source);
          mode = mcrRelayService.isRunning(channelId) ? 'relay' : 'slate';
        } catch (err) {
          logger.warn(
            `[MCR_BUS] channelId=${channelId} bus route failed for source=${source.label}: ${err}`
          );
        }
      }
    }

    const ready = await this.waitForBusOnNginx(busKey, 12000);
    if (!ready) {
      if (!mcrBusHolderService.isHolding(channelId)) {
        await mcrBusHolderService.startSlate(channelId);
      }
      const slateOk = await this.waitForBusOnNginx(busKey, 12000);
      if (!slateOk) {
        throw new Error(
          'MCR program bus is not publishing on nginx-rtmp. Check nginx-rtmp is running and reachable from backend.'
        );
      }
      mode = 'slate';
    }

    logger.info(
      `[MCR_BUS] channelId=${channelId} mode=${mode} source=${sourceLabel ?? 'slate'} ` +
        `onNginx=${ready || mode === 'slate'}`
    );

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true },
    });
    if (channel?.slug) {
      void mcrMediaAuditService.auditChannel(channelId, channel.slug, 'ensureProgramBus');
    }

    await mcrBindingService.auditBinding(channelId, 'ensureProgramBus');

    return { mode, sourceLabel };
  }

  /** Block until the MCR bus RTMP endpoint is readable (nginx stat or ffprobe). */
  async waitForBusPlayable(channelId: string, timeoutMs = 30000): Promise<boolean> {
    try {
      await this.ensureBusPublisherOnNginx(channelId);
    } catch {
      return false;
    }
    const busKey = mcrRelayService.getBusStreamKey(channelId);
    return this.waitForBusOnNginx(busKey, timeoutMs);
  }

  private async ensureBusPublisherOnNginx(channelId: string): Promise<void> {
    const busKey = mcrRelayService.getBusStreamKey(channelId);
    if (await this.isBusOnNginx(busKey)) return;

    if (!mcrBusHolderService.isHolding(channelId) && !mcrRelayService.isRunning(channelId)) {
      await mcrBusHolderService.startSlate(channelId);
    }

    const ready = await this.waitForBusOnNginx(busKey, 15000);
    if (!ready) {
      throw new Error(
        `MCR bus publisher not visible on nginx-rtmp for key=${busKey}`
      );
    }
    logger.info(`[MCR_BUS] channelId=${channelId} bootstrap=publisher-on-nginx key=${busKey}`);
  }

  private async isBusOnNginx(streamKey: string): Promise<boolean> {
    const url = buildMcrInternalIngestUrl(streamKey);
    return probeRtmpPlayable(url, { context: `bus-check-${streamKey}`, killAfterMs: 5000 });
  }

  private async waitForBusOnNginx(streamKey: string, timeoutMs: number): Promise<boolean> {
    const url = buildMcrInternalIngestUrl(streamKey);
    return waitForRtmpPlayable(url, timeoutMs, { context: `bus-wait-${streamKey}` });
  }

  private async waitForBusPublisher(
    streamKey: string,
    timeoutMs: number,
    _channelId?: string
  ): Promise<boolean> {
    return this.waitForBusOnNginx(streamKey, timeoutMs);
  }

  /** Restore MCR sessions and program bus after backend restart. */
  async recoverRelaysOnStartup(): Promise<void> {
    const routers = await prisma.mcrRouterState.findMany({
      where: { enabled: true },
      include: { sources: true },
    });
    for (const router of routers) {
      try {
        await this.migrateMcrChannelSourceUrl(router.channelId);
        await mcrSourceSessionService.syncRouterSessions(
          router.channelId,
          router.sources.filter((s) => s.enabled),
          (source) => this.resolveRelayInput(source)
        );
        await this.ensureProgramBus(router.channelId);
        await this.ensureMcrOutputPipeline(router.channelId);
        if (!this.isV2Switcher()) {
          await mcrBindingService.assertProgramEncoderBound(router.channelId, 'recoverRelaysOnStartup');
        }
        logger.info(
          `[MCR_RECOVER] channelId=${router.channelId} architecture=${env.MCR_ARCHITECTURE} restored`
        );
      } catch (err) {
        logger.error(`[MCR_RECOVER] channelId=${router.channelId} binding failed: ${err}`);
        await prisma.channel.update({
          where: { id: router.channelId },
          data: { status: 'ERROR' },
        });
        wsService.emitChannelStatus(router.channelId, 'ERROR');
      }
    }
  }
}

export const sourceRouterService = new SourceRouterService();
