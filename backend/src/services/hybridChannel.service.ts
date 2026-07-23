import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import { hybridOutputService } from './hybridOutput.service';
import { monitorService } from './monitor.service';
import { wsService } from './websocket.service';
import type { HybridActiveSource, HybridNormalizationMode } from '@prisma/client';

export interface HybridChannelSnapshot {
  channelId: string;
  activeSource: HybridActiveSource;
  liveFeedUrl: string | null;
  stationIdVideoPath: string | null;
  stationIdPlaylistId: string | null;
  stationIdPlaylistItemId: string | null;
  blueprintNormalization: HybridNormalizationMode;
  stationNormalization: HybridNormalizationMode;
  liveNormalization: HybridNormalizationMode;
  transitionInProgress: boolean;
  lastSwitchAt: string | null;
  viewerUrl: string;
  canGoLive: boolean;
  canReturnToSchedule: boolean;
}

class HybridChannelService {
  async ensureState(channelId: string) {
    const existing = await prisma.hybridChannelState.findUnique({ where: { channelId } });
    if (existing) return existing;

    return prisma.hybridChannelState.create({
      data: { channelId },
    });
  }

  async getSnapshot(channelId: string): Promise<HybridChannelSnapshot> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { hybrid: true },
    });
    if (!channel) throw new AppError('Channel not found', 404);
    if (!channel.useBlueprint) {
      throw new AppError('Hybrid Channel is only available for blueprint channels', 400);
    }

    const state = channel.hybrid ?? (await this.ensureState(channelId));

    return {
      channelId,
      activeSource: state.activeSource,
      liveFeedUrl: state.liveFeedUrl,
      stationIdVideoPath: state.stationIdVideoPath,
      stationIdPlaylistId: state.stationIdPlaylistId,
      stationIdPlaylistItemId: state.stationIdPlaylistItemId,
      blueprintNormalization: state.blueprintNormalization,
      stationNormalization: state.stationNormalization,
      liveNormalization: state.liveNormalization,
      transitionInProgress: state.transitionInProgress,
      lastSwitchAt: state.lastSwitchAt?.toISOString() ?? null,
      viewerUrl: `/stream/${channel.slug}/master.m3u8`,
      canGoLive:
        !state.transitionInProgress &&
        state.activeSource === 'BLUEPRINT' &&
        !!state.liveFeedUrl?.trim() &&
        channel.status === 'ONLINE',
      canReturnToSchedule:
        !state.transitionInProgress &&
        state.activeSource === 'LIVE' &&
        channel.status === 'ONLINE',
    };
  }

  async updateConfig(
    channelId: string,
    data: {
      liveFeedUrl?: string | null;
      stationIdVideoPath?: string | null;
      stationIdPlaylistId?: string | null;
      stationIdPlaylistItemId?: string | null;
      blueprintNormalization?: HybridNormalizationMode;
      stationNormalization?: HybridNormalizationMode;
      liveNormalization?: HybridNormalizationMode;
    }
  ): Promise<HybridChannelSnapshot> {
    await this.ensureBlueprintChannel(channelId);
    await this.ensureState(channelId);

    const stationPath =
      data.stationIdVideoPath !== undefined ? data.stationIdVideoPath : undefined;
    const stationPlaylistId =
      data.stationIdPlaylistId !== undefined ? data.stationIdPlaylistId : undefined;
    const stationPlaylistItemId =
      data.stationIdPlaylistItemId !== undefined ? data.stationIdPlaylistItemId : undefined;

    const clearingStation =
      stationPath === null ||
      (typeof stationPath === 'string' && stationPath.trim() === '');

    await prisma.hybridChannelState.update({
      where: { channelId },
      data: {
        liveFeedUrl: data.liveFeedUrl !== undefined ? data.liveFeedUrl : undefined,
        stationIdVideoPath: clearingStation ? null : stationPath,
        stationIdPlaylistId: clearingStation ? null : stationPlaylistId,
        stationIdPlaylistItemId: clearingStation ? null : stationPlaylistItemId,
        blueprintNormalization: data.blueprintNormalization,
        stationNormalization: data.stationNormalization,
        liveNormalization: data.liveNormalization,
      },
    });

    return this.getSnapshot(channelId);
  }

  async goLive(channelId: string): Promise<HybridChannelSnapshot> {
    const channel = await this.ensureBlueprintChannel(channelId);
    const state = await this.ensureState(channelId);
    await this.reconcileTransitionState(channelId);

    const current = await prisma.hybridChannelState.findUnique({ where: { channelId } });
    if (current?.transitionInProgress) {
      throw new AppError('A source transition is already in progress', 409);
    }
    if (current?.activeSource === 'LIVE') {
      return this.getSnapshot(channelId);
    }
    if (!state.liveFeedUrl?.trim()) {
      throw new AppError('Configure a live feed URL before going live', 400);
    }
    if (channel.status !== 'ONLINE') {
      throw new AppError('Start the channel before going live', 400);
    }

    await prisma.hybridChannelState.update({
      where: { channelId },
      data: { transitionInProgress: true, activeSource: 'TRANSITION' },
    });
    this.emitState(channelId);

    void this.runGoLive(channelId, channel, state);

    return this.getSnapshot(channelId);
  }

  async returnToSchedule(channelId: string): Promise<HybridChannelSnapshot> {
    const channel = await this.ensureBlueprintChannel(channelId);
    const state = await this.ensureState(channelId);
    await this.reconcileTransitionState(channelId);

    const current = await prisma.hybridChannelState.findUnique({ where: { channelId } });
    if (current?.transitionInProgress) {
      throw new AppError('A source transition is already in progress', 409);
    }
    if (current?.activeSource === 'BLUEPRINT') {
      return this.getSnapshot(channelId);
    }
    if (channel.status !== 'ONLINE') {
      throw new AppError('Channel must be online', 400);
    }

    await prisma.hybridChannelState.update({
      where: { channelId },
      data: { transitionInProgress: true, activeSource: 'TRANSITION' },
    });
    this.emitState(channelId);

    void this.runReturnToSchedule(channelId, channel, state);

    return this.getSnapshot(channelId);
  }

  private async runGoLive(
    channelId: string,
    channel: { id: string; name: string; slug: string; transcodingProfile?: { resolution?: string | null } | null },
    state: {
      liveFeedUrl: string | null;
      liveNormalization: HybridNormalizationMode;
      stationNormalization: HybridNormalizationMode;
    }
  ): Promise<void> {
    try {
      const livePrep = hybridOutputService.prepareLiveFeed(
        state.liveFeedUrl!,
        state.liveNormalization
      );

      const freshState = await prisma.hybridChannelState.findUnique({ where: { channelId } });
      const stationPath = freshState ? await this.resolveStationIdPath(freshState) : null;
      logger.info(
        `[HYBRID] go-live channel=${channel.slug} stationBumper=${stationPath ? 'yes' : 'no'}`
      );

      let spliced = false;
      const markSpliced = async () => {
        if (spliced) return;
        spliced = true;
        await prisma.hybridChannelState.update({
          where: { channelId },
          data: {
            activeSource: 'LIVE',
            transitionInProgress: false,
            lastSwitchAt: new Date(),
          },
        });
        const snapshot = await this.getSnapshot(channelId);
        this.emitState(channelId);
        wsService.emitHybridState(channelId, { ...snapshot, streamReady: true });
      };

      await hybridOutputService.transitionToLive(channel, {
        liveFeedUrl: state.liveFeedUrl!,
        normalization: state.liveNormalization,
        stationPath,
        stationNormalization: freshState?.stationNormalization ?? state.stationNormalization,
        prefetched: await livePrep,
        onSpliced: () => {
          void markSpliced();
        },
      });

      if (!spliced) {
        await markSpliced();
      }

      monitorService.addLog(channelId, 'INFO', 'Hybrid: Go Live complete — viewers stay on same URL');
      logger.info(`[HYBRID] go-live channel=${channel.slug}`);
    } catch (err) {
      logger.error(`[HYBRID] go-live failed channel=${channel.slug}:`, err);
      monitorService.addLog(
        channelId,
        'ERROR',
        `Go Live failed: ${err instanceof Error ? err.message : String(err)}`
      );
      await prisma.hybridChannelState.update({
        where: { channelId },
        data: { activeSource: 'BLUEPRINT', transitionInProgress: false },
      });
      try {
        const full = await prisma.channel.findUnique({ where: { id: channel.id } });
        if (full) await this.resumeBlueprint(full);
      } catch (resumeErr) {
        logger.error(`[HYBRID] blueprint recovery after go-live failed channel=${channel.slug}:`, resumeErr);
      }
      const snapshot = await this.getSnapshot(channelId);
      this.emitState(channelId);
      wsService.emitHybridState(channelId, { ...snapshot, streamReady: false, error: 'Go Live failed' });
    }
  }

  private async runReturnToSchedule(
    channelId: string,
    channel: { id: string; name: string; slug: string; useBlueprint?: boolean; transcodingProfile?: { resolution?: string | null } | null },
    state: { stationNormalization: HybridNormalizationMode }
  ): Promise<void> {
    try {
      const freshState = await prisma.hybridChannelState.findUnique({ where: { channelId } });
      const stationPath = freshState ? await this.resolveStationIdPath(freshState) : null;
      logger.info(
        `[HYBRID] return-to-schedule channel=${channel.slug} stationBumper=${stationPath ? 'yes' : 'no'}`
      );

      let spliced = false;
      const markSpliced = async () => {
        if (spliced) return;
        spliced = true;
        await prisma.hybridChannelState.update({
          where: { channelId },
          data: {
            activeSource: 'BLUEPRINT',
            transitionInProgress: false,
            lastSwitchAt: new Date(),
            decoderPid: null,
          },
        });
        const snapshot = await this.getSnapshot(channelId);
        this.emitState(channelId);
        wsService.emitHybridState(channelId, { ...snapshot, streamReady: true });
      };

      await hybridOutputService.transitionToSchedule(channel, {
        stationPath,
        stationNormalization: freshState?.stationNormalization ?? state.stationNormalization,
        onSpliced: () => {
          void markSpliced();
        },
      });

      if (!spliced) {
        await markSpliced();
      }

      monitorService.addLog(channelId, 'INFO', 'Hybrid: returned to blueprint schedule');
      logger.info(`[HYBRID] return-to-schedule channel=${channel.slug}`);
    } catch (err) {
      logger.error(`[HYBRID] return-to-schedule failed channel=${channel.slug}:`, err);
      monitorService.addLog(
        channelId,
        'ERROR',
        `Return to schedule failed: ${err instanceof Error ? err.message : String(err)}`
      );
      await prisma.hybridChannelState.update({
        where: { channelId },
        data: { activeSource: 'LIVE', transitionInProgress: false },
      });
      const snapshot = await this.getSnapshot(channelId);
      this.emitState(channelId);
      wsService.emitHybridState(channelId, { ...snapshot, streamReady: false, error: 'Return failed' });
    }
  }

  /** Clear stuck TRANSITION flag when no decoder is running (e.g. client timed out). */
  private async reconcileTransitionState(channelId: string): Promise<void> {
    const state = await prisma.hybridChannelState.findUnique({ where: { channelId } });
    if (!state?.transitionInProgress || state.activeSource !== 'TRANSITION') return;

    const liveRunning = hybridOutputService.isRunning(channelId);
    const blueprintRunning = !!ffmpegService.getProcessInfo(channelId);
    const prewarmRunning = ffmpegService.isBlueprintPrewarmRunning(channelId);
    if (liveRunning || blueprintRunning || prewarmRunning) return;

    const staleMs = Date.now() - state.updatedAt.getTime();
    if (staleMs < 90_000) return;

    const fallback: HybridActiveSource = state.liveFeedUrl?.trim() ? 'LIVE' : 'BLUEPRINT';
    logger.warn(`[HYBRID] clearing stale transition channelId=${channelId} → ${fallback}`);
    await prisma.hybridChannelState.update({
      where: { channelId },
      data: { transitionInProgress: false, activeSource: fallback },
    });
  }

  /** Recover live override after server restart. Returns true if handled. */
  async recover(channelId: string): Promise<boolean> {
    const state = await prisma.hybridChannelState.findUnique({ where: { channelId } });
    if (!state || state.activeSource !== 'LIVE' || !state.liveFeedUrl?.trim()) {
      return false;
    }

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { transcodingProfile: true },
    });
    if (!channel) return false;

    logger.info(`[HYBRID] recovering live feed channel=${channel.slug}`);
    monitorService.addLog(channelId, 'INFO', 'Hybrid: recovering live feed after restart');
    await hybridOutputService.startLiveFeed(channel, state.liveFeedUrl, state.liveNormalization);
    return true;
  }

  async isLiveOverride(channelId: string): Promise<boolean> {
    const state = await prisma.hybridChannelState.findUnique({ where: { channelId } });
    return state?.activeSource === 'LIVE';
  }

  private async resumeBlueprint(channel: {
    id: string;
    name: string;
    slug: string;
    useBlueprint?: boolean;
    status: string;
  }): Promise<void> {
    const full = await prisma.channel.findUnique({
      where: { id: channel.id },
      include: { transcodingProfile: true, overlays: true, playlist: true, blueprint: true },
    });
    if (!full) throw new AppError('Channel not found', 404);

    ffmpegService.clearReconnectState(channel.id);
    await ffmpegService.startStream(full, { force: true, hybridHandoff: true });
  }

  private hasStationIdConfigured(state: {
    stationIdVideoPath: string | null;
    stationIdPlaylistId: string | null;
    stationIdPlaylistItemId: string | null;
  }): boolean {
    return !!state.stationIdVideoPath?.trim();
  }

  private async resolveStationIdPath(state: {
    stationIdVideoPath: string | null;
    stationIdPlaylistId: string | null;
    stationIdPlaylistItemId: string | null;
  }): Promise<string | null> {
    const manual = state.stationIdVideoPath?.trim();
    if (!manual) {
      return null;
    }

    if (state.stationIdPlaylistItemId?.trim()) {
      const item = await prisma.playlistItem.findUnique({
        where: { id: state.stationIdPlaylistItemId },
      });
      if (item?.status === 'READY' && item.videoPath) {
        return item.videoPath;
      }
    }

    return manual;
  }

  private async ensureBlueprintChannel(channelId: string) {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { transcodingProfile: true },
    });
    if (!channel) throw new AppError('Channel not found', 404);
    if (!channel.useBlueprint) {
      throw new AppError('Hybrid Channel is only available for blueprint channels', 400);
    }
    return channel;
  }

  private emitState(channelId: string): void {
    void this.getSnapshot(channelId)
      .then((snapshot) => wsService.emitHybridState(channelId, snapshot))
      .catch(() => {});
  }
}

export const hybridChannelService = new HybridChannelService();
