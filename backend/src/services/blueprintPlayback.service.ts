import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { blueprintService } from './blueprint.service';
import { blueprintWindowAuditService } from './blueprintWindowAudit.service';
import { blueprintExecutionService } from './blueprintExecution.service';
import { migrateCursorState } from './blueprintStateMigration';
import type { BlueprintBlock, BlueprintRuntimeState, ResolvedSegment } from '../types/blueprint.types';
import { probeMediaDurationSec } from './mediaProbe.service';
import {
  getActivePlaybackTimeSec,
  logPlaybackTimeSource,
  type PlaybackTimeSource,
} from './playbackClock.service';
import { playbackSyncService } from './playbackSync.service';

export interface BlueprintWindowSegment extends ResolvedSegment {
  videoPath?: string;
  /** ffprobe duration — used for cursor index; schedule startsAt/endsAt stay metadata-based */
  playbackDurationSec?: number;
}

export interface PersistedBlueprintExecution {
  blueprintId: string;
  engineState: BlueprintRuntimeState;
  scheduleAnchorMs: number;
  scheduleCursorMs: number;
  windowsEmitted: number;
  executionSeed: number;
  updatedAt: string;
  /** Bumped on window roll / restart — invalidates timeline caches */
  playbackEpoch?: number;
  streamStartedAt?: number | null;
  /** Cached window — hydrate without re-executing (prevents state drift on cursor poll) */
  windowSegments?: ResolvedSegment[];
  /** Playlist edits queued for next natural window roll */
  pendingPlaylistChanges?: boolean;
  pendingChangesAt?: string;
  /** Pre-built next window — applied only on natural window roll */
  pendingNextWindow?: {
    engineState: BlueprintRuntimeState;
    scheduleAnchorMs: number;
    scheduleCursorMs: number;
    executionSeed: number;
    windowSegments: BlueprintWindowSegment[];
    concatContent: string;
    concatEntries: string[];
    totalDurationSec: number;
    windowScheduleStartMs: number;
  };
}

export interface TimelineMergeContext {
  pinnedSegments: ResolvedSegment[];
  futureStartTime: Date;
  futureInitialState: BlueprintRuntimeState | undefined;
  seed: number;
  scheduleAnchorMs: number;
  scheduleCursorMs: number;
  pendingPlaylistChanges: boolean;
}

export interface LiveEngineCursor {
  windowIndex: number;
  blockId: string;
  blockLabel: string;
  blockType: string;
  title: string;
  itemId: string | null;
  occurrenceIndex: number;
  startsAt: string;
  endsAt: string;
}

export interface PlaybackTimingDiagnostics {
  activePlaybackTimeSec: number;
  currentIndex: number;
  segmentOffsetSec: number;
  playbackSource: 'FFmpeg';
  timeSource: PlaybackTimeSource;
}

export interface LiveCursorResult {
  channelId: string;
  blueprintId: string;
  now: string;
  /** Current segment from activePlaybackTimeSec */
  current: LiveEngineCursor | null;
  /** @deprecated same as current */
  engine: LiveEngineCursor | null;
  /** @deprecated same as current */
  visible: LiveEngineCursor | null;
  timing: PlaybackTimingDiagnostics | null;
  scheduleAnchorMs: number | null;
  cursorSource: PlaybackTimeSource;
  activePlaybackTimeSec: number;
  /** @deprecated use activePlaybackTimeSec */
  activeFfmpegTimeSec: number;
  playbackEpoch: number;
  inSync: boolean;
  mismatch?: string | null;
}

export interface BlueprintPlaybackRuntime {
  channelId: string;
  blueprintId: string;
  blueprintName: string;
  segments: BlueprintWindowSegment[];
  totalDurationSec: number;
  streamStartedAt: number | null;
  /** Index in window from activePlaybackTimeSec */
  currentIndex: number;
  /** @deprecated same as currentIndex */
  engineSegmentIndex: number;
  /** Single playback clock — FFmpeg time= within current concat window */
  activePlaybackTimeSec: number;
  segmentOffsetSec: number;
  windowScheduleStartMs: number;
  updatedAt: number;
  engineState: BlueprintRuntimeState;
  scheduleAnchorMs: number;
  scheduleCursorMs: number;
  executionSeed: number;
  channelSlug?: string;
  playbackEpoch: number;
}

export interface PlaybackDiagnostics {
  channelId: string;
  playbackSource: 'BLUEPRINT' | 'PLAYLIST';
  blueprintId?: string | null;
  blueprintName?: string | null;
  currentBlock?: string | null;
  currentBlockType?: string | null;
  currentPlaylist?: string | null;
  currentAsset?: string | null;
  nextBlock?: string | null;
  nextBlockType?: string | null;
  nextPlaylist?: string | null;
  nextAsset?: string | null;
  windowSegmentIndex?: number;
  windowSegmentCount?: number;
}

/** Rolling-window concat for blueprint channels — uses blueprintExecutionService (single source of truth). */
export type WindowRefreshReason =
  | 'window_roll'
  | 'blueprint_changed'
  | 'window_refresh'
  | 'playlist_mutation';

export interface ChannelWindowBuild {
  channelId: string;
  blueprintId: string;
  windowSegments: BlueprintWindowSegment[];
  concatContent: string;
  concatEntries: string[];
  engineState: BlueprintRuntimeState;
  scheduleAnchorMs: number;
  scheduleCursorMs: number;
  executionSeed: number;
  totalDurationSec: number;
  windowScheduleStartMs: number;
}

class BlueprintPlaybackService {
  private readonly windowSize = 24;
  private readonly runtimes = new Map<string, BlueprintPlaybackRuntime>();
  private readonly lastCursorPersist = new Map<string, number>();

  getBlueprintConcatPath(channelId: string): string {
    const dir = path.join(env.STREAMS_DIR, 'blueprints');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${channelId}.txt`);
  }

  private stateFilePath(channelId: string): string {
    return path.join(env.STREAMS_DIR, 'blueprints', `${channelId}.state.json`);
  }

  loadPersistedState(channelId: string): PersistedBlueprintExecution | null {
    try {
      const file = this.stateFilePath(channelId);
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedBlueprintExecution;
    } catch {
      return null;
    }
  }

  savePersistedState(channelId: string, data: PersistedBlueprintExecution): void {
    const file = this.stateFilePath(channelId);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 0), 'utf8');
  }

  private logWindowReset(channelId: string, rt: BlueprintPlaybackRuntime, reason: string): void {
    logger.info(
      `[WINDOW_RESET] channelId=${channelId} reason=${reason} ` +
        `activePlaybackTimeSec=${rt.activePlaybackTimeSec} currentIndex=${rt.currentIndex} ` +
        `segmentOffsetSec=${rt.segmentOffsetSec}`
    );
  }

  private zeroPlaybackPosition(rt: BlueprintPlaybackRuntime): void {
    rt.activePlaybackTimeSec = 0;
    rt.currentIndex = 0;
    rt.engineSegmentIndex = 0;
    rt.segmentOffsetSec = 0;
  }

  private normalizeActiveTimeSec(elapsedSec: number, totalDurationSec: number): number {
    if (totalDurationSec <= 0) return Math.max(0, elapsedSec);
    if (elapsedSec <= totalDurationSec + 6) return Math.max(0, elapsedSec);
    return ((elapsedSec % totalDurationSec) + totalDurationSec) % totalDurationSec;
  }

  getPlaybackEpoch(channelId: string): number {
    const persisted = this.loadPersistedState(channelId);
    const rt = this.runtimes.get(channelId);
    return rt?.playbackEpoch ?? persisted?.playbackEpoch ?? 0;
  }

  clearPersistedState(channelId: string): void {
    const file = this.stateFilePath(channelId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  /** Execution context for timeline sync — same anchor/seed as live engine. */
  getExecutionContext(
    channelId: string,
    blueprintId?: string
  ): {
    initialState?: BlueprintRuntimeState;
    startTime: Date;
    seed: number;
    blueprintId: string;
    scheduleCursorMs: number;
    hasLiveState: boolean;
  } | null {
    const persisted = this.loadPersistedState(channelId);
    const runtime = this.runtimes.get(channelId);
    const resolvedBlueprintId = blueprintId ?? runtime?.blueprintId ?? persisted?.blueprintId;
    if (!resolvedBlueprintId) return null;

    const anchorMs = runtime?.scheduleAnchorMs ?? persisted?.scheduleAnchorMs ?? Date.now();
    const scheduleCursorMs = runtime?.scheduleCursorMs ?? persisted?.scheduleCursorMs ?? anchorMs;
    const seed =
      runtime?.executionSeed ??
      persisted?.executionSeed ??
      blueprintExecutionService.executionSeed(channelId, resolvedBlueprintId);

    return {
      blueprintId: resolvedBlueprintId,
      startTime: new Date(anchorMs),
      scheduleCursorMs,
      initialState: runtime?.engineState ?? persisted?.engineState,
      seed,
      hasLiveState: !!(runtime || persisted),
    };
  }

  markStreamStarted(channelId: string, channelSlug?: string): void {
    const rt = this.runtimes.get(channelId);
    if (rt) {
      rt.streamStartedAt = Date.now();
      this.zeroPlaybackPosition(rt);
      if (channelSlug) rt.channelSlug = channelSlug;
      rt.updatedAt = Date.now();
      this.logWindowReset(channelId, rt, 'stream_started');
      blueprintService.invalidateTimelineCaches(rt.blueprintId, 'CHANNEL_RESTART');
      playbackSyncService.startMonitoring(channelId, rt.blueprintId);
    }
  }

  /** Called when FFmpeg restarts after a rolling window advance. */
  markWindowRolled(channelId: string): void {
    const rt = this.runtimes.get(channelId);
    if (!rt) return;
    this.zeroPlaybackPosition(rt);
    rt.streamStartedAt = Date.now();
    if (rt.segments[0]) {
      rt.windowScheduleStartMs = new Date(rt.segments[0].startsAt).getTime();
    }
    rt.updatedAt = Date.now();
    this.logWindowReset(channelId, rt, 'window_rolled');
  }

  private segmentDurationSec(seg: BlueprintWindowSegment): number {
    const d = seg.playbackDurationSec ?? seg.durationSec;
    return Number.isFinite(d) && d > 0 ? d : 120;
  }

  private findIndexAtElapsed(rt: BlueprintPlaybackRuntime, elapsedSec: number): {
    index: number;
    offsetSec: number;
  } {
    if (rt.segments.length === 0) {
      return { index: 0, offsetSec: 0 };
    }

    const totalPlaybackSec = rt.segments.reduce((s, seg) => s + this.segmentDurationSec(seg), 0);
    if (totalPlaybackSec <= 0) {
      return { index: 0, offsetSec: 0 };
    }

    let remaining = elapsedSec;
    if (remaining >= totalPlaybackSec) {
      remaining = remaining % totalPlaybackSec;
    }

    for (let i = 0; i < rt.segments.length; i++) {
      const dur = this.segmentDurationSec(rt.segments[i]);
      if (remaining < dur) {
        return { index: i, offsetSec: remaining };
      }
      remaining -= dur;
    }
    return { index: 0, offsetSec: 0 };
  }

  private segmentToCursor(seg: BlueprintWindowSegment, windowIndex: number): LiveEngineCursor {
    return {
      windowIndex,
      blockId: seg.blockId,
      blockLabel: seg.blockLabel,
      blockType: seg.blockType,
      title: seg.title,
      itemId: seg.itemId,
      occurrenceIndex: seg.occurrenceIndex,
      startsAt: seg.startsAt,
      endsAt: seg.endsAt,
    };
  }

  /**
   * Recalculate currentIndex from activePlaybackTimeSec — full recompute, no incremental state.
   */
  syncPlaybackFromFfmpeg(channelId: string, logTransitions = false): BlueprintPlaybackRuntime | undefined {
    const rt = this.runtimes.get(channelId);
    if (!rt?.segments.length || rt.totalDurationSec <= 0) return rt;

    const { activePlaybackTimeSec: rawSec, source } = getActivePlaybackTimeSec(
      channelId,
      rt.activePlaybackTimeSec
    );
    const activePlaybackTimeSec = this.normalizeActiveTimeSec(rawSec, rt.totalDurationSec);
    const pos = this.findIndexAtElapsed(rt, activePlaybackTimeSec);
    const prevIndex = rt.currentIndex;

    rt.activePlaybackTimeSec = activePlaybackTimeSec;
    rt.currentIndex = pos.index;
    rt.engineSegmentIndex = pos.index;
    rt.segmentOffsetSec = pos.offsetSec;
    rt.updatedAt = Date.now();

    const seg = rt.segments[pos.index];
    if (logTransitions && prevIndex !== pos.index && seg) {
      logger.info(
        `[MEDIA_TRANSITION] channelId=${channelId} media=${seg.title} ` +
          `index=${pos.index} activePlaybackTimeSec=${activePlaybackTimeSec.toFixed(2)} source=${source}`
      );
    }

    return rt;
  }

  /** @deprecated use syncPlaybackFromFfmpeg */
  syncObserversFromFfmpeg(channelId: string): BlueprintPlaybackRuntime | undefined {
    return this.syncPlaybackFromFfmpeg(channelId, false);
  }

  private buildTimingDiagnostics(
    rt: BlueprintPlaybackRuntime,
    source: PlaybackTimeSource
  ): PlaybackTimingDiagnostics {
    return {
      activePlaybackTimeSec: rt.activePlaybackTimeSec,
      currentIndex: rt.currentIndex,
      segmentOffsetSec: rt.segmentOffsetSec,
      playbackSource: 'FFmpeg',
      timeSource: source,
    };
  }

  updatePlaybackPosition(channelId: string, _rawFfmpegTimeSec: number): void {
    const rt = this.runtimes.get(channelId);
    if (!rt) return;
    this.syncPlaybackFromFfmpeg(channelId, true);
    this.persistCursorSnapshot(channelId, rt);
  }

  private persistCursorSnapshot(channelId: string, rt: BlueprintPlaybackRuntime): void {
    const now = Date.now();
    const last = this.lastCursorPersist.get(channelId) ?? 0;
    if (now - last < 5000) return;
    this.lastCursorPersist.set(channelId, now);

    const persisted = this.loadPersistedState(channelId);
    if (!persisted) return;

    this.savePersistedState(channelId, {
      ...persisted,
      streamStartedAt: rt.streamStartedAt,
      playbackEpoch: rt.playbackEpoch,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Hydrate runtime from disk — schedule/engine only; playback position from FFmpeg. */
  hydrateRuntimeFromPersisted(channelId: string): BlueprintPlaybackRuntime | null {
    const persisted = this.loadPersistedState(channelId);
    if (!persisted?.windowSegments?.length) return null;

    const rejectedElapsed = (persisted as { playbackElapsedSec?: number }).playbackElapsedSec;
    const rejectedIndex = (persisted as { currentIndex?: number }).currentIndex;
    const rejectedVisible = (persisted as { visibleTimeSec?: number }).visibleTimeSec;
    if (rejectedElapsed != null || rejectedIndex != null || rejectedVisible != null) {
      logger.info(
        `[HYDRATE_REJECTED_PLAYBACK_STATE] channelId=${channelId} ` +
          `ignoredPlaybackElapsedSec=${rejectedElapsed ?? 'n/a'} ignoredCurrentIndex=${rejectedIndex ?? 'n/a'} ` +
          `ignoredVisibleTimeSec=${rejectedVisible ?? 'n/a'}`
      );
    }

    const rt: BlueprintPlaybackRuntime = {
      channelId,
      blueprintId: persisted.blueprintId,
      blueprintName: '',
      segments: persisted.windowSegments as BlueprintWindowSegment[],
      totalDurationSec: persisted.windowSegments.reduce(
        (s, seg) => s + ((seg as BlueprintWindowSegment).playbackDurationSec ?? seg.durationSec),
        0
      ),
      streamStartedAt: persisted.streamStartedAt ?? null,
      currentIndex: 0,
      engineSegmentIndex: 0,
      activePlaybackTimeSec: 0,
      segmentOffsetSec: 0,
      windowScheduleStartMs: persisted.windowSegments[0]
        ? new Date(persisted.windowSegments[0].startsAt).getTime()
        : 0,
      updatedAt: Date.now(),
      engineState: persisted.engineState,
      scheduleAnchorMs: persisted.scheduleAnchorMs,
      scheduleCursorMs: persisted.scheduleCursorMs,
      executionSeed: persisted.executionSeed,
      playbackEpoch: persisted.playbackEpoch ?? 0,
    };
    this.runtimes.set(channelId, rt);
    this.logWindowReset(channelId, rt, 'hydrate');
    return rt;
  }

  /** Rebuild in-memory runtime when backend restarted — never re-execute on read. */
  async ensureRuntime(channelId: string): Promise<BlueprintPlaybackRuntime | null> {
    const existing = this.runtimes.get(channelId);
    if (existing && existing.segments.length > 0) return existing;

    const hydrated = this.hydrateRuntimeFromPersisted(channelId);
    if (hydrated) {
      if (hydrated.segments.some((s) => s.occurrenceIndex == null)) {
        logger.warn(
          `[WINDOW_REFRESH] channelId=${channelId} reason=missing_occurrence_index on persisted window`
        );
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { status: true },
        });
        if (channel?.status === 'ONLINE' || channel?.status === 'STARTING') {
          await this.refreshChannelWindow(channelId);
          return this.runtimes.get(channelId) ?? null;
        }
      }
      return hydrated;
    }

    const persisted = this.loadPersistedState(channelId);
    if (!persisted) return null;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { status: true, useBlueprint: true },
    });
    if (!channel?.useBlueprint) return null;

    // Only rebuild window when channel is actively starting — not on cursor polls
    if (channel.status === 'ONLINE' || channel.status === 'STARTING') {
      await this.refreshChannelWindow(channelId);
    }
    return this.runtimes.get(channelId) ?? null;
  }

  /** Current media from activePlaybackTimeSec only. */
  async getLiveCursor(channelId: string, blueprintId: string): Promise<LiveCursorResult> {
    let rt = this.runtimes.get(channelId);
    if (!rt?.segments.length) {
      rt = (await this.ensureRuntime(channelId)) ?? undefined;
    }
    const persisted = this.loadPersistedState(channelId);
    const nowIso = new Date().toISOString();

    let current: LiveEngineCursor | null = null;
    let timing: PlaybackTimingDiagnostics | null = null;
    let source: PlaybackTimeSource = 'fallback_zero';
    let activePlaybackTimeSec = 0;

    if (rt && rt.segments.length > 0) {
      const clock = getActivePlaybackTimeSec(channelId, rt.activePlaybackTimeSec);
      source = clock.source;
      activePlaybackTimeSec = clock.activePlaybackTimeSec;
      logPlaybackTimeSource(channelId, source, activePlaybackTimeSec);
      this.syncPlaybackFromFfmpeg(channelId, false);

      const seg = rt.segments[rt.currentIndex];
      if (seg) current = this.segmentToCursor(seg, rt.currentIndex);
      timing = this.buildTimingDiagnostics(rt, source);

      logger.info(
        `[LIVE_CURSOR] media=${seg?.title ?? 'none'} index=${rt.currentIndex} ` +
          `activePlaybackTimeSec=${rt.activePlaybackTimeSec.toFixed(1)} source=${source}`
      );
    } else {
      logger.info(`[LIVE_CURSOR] Channel=${channelId} Segment=none Media=none Timestamp=${nowIso}`);
    }

    return {
      channelId,
      blueprintId,
      now: nowIso,
      current,
      engine: current,
      visible: current,
      timing,
      scheduleAnchorMs: rt?.scheduleAnchorMs ?? persisted?.scheduleAnchorMs ?? null,
      cursorSource: source,
      activePlaybackTimeSec: rt?.activePlaybackTimeSec ?? activePlaybackTimeSec,
      activeFfmpegTimeSec: rt?.activePlaybackTimeSec ?? activePlaybackTimeSec,
      playbackEpoch: rt?.playbackEpoch ?? persisted?.playbackEpoch ?? 0,
      inSync: true,
    };
  }

  getRuntime(channelId: string): BlueprintPlaybackRuntime | undefined {
    return this.runtimes.get(channelId);
  }

  async getDiagnostics(channelId: string): Promise<PlaybackDiagnostics | null> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { blueprint: true, playlist: true },
    });
    if (!channel) return null;

    if (!channel.useBlueprint || !channel.blueprintId) {
      return {
        channelId,
        playbackSource: 'PLAYLIST',
        blueprintId: channel.blueprintId,
        blueprintName: null,
        currentPlaylist: channel.playlist?.name ?? null,
      };
    }

    const rt = this.syncPlaybackFromFfmpeg(channelId);
    const current = rt?.segments[rt.currentIndex];
    const next = rt?.segments.length
      ? rt.segments[(rt.currentIndex + 1) % rt.segments.length]
      : undefined;

    return {
      channelId,
      playbackSource: 'BLUEPRINT',
      blueprintId: channel.blueprintId,
      blueprintName: channel.blueprint?.name ?? rt?.blueprintName ?? null,
      currentBlock: current?.blockLabel ?? null,
      currentBlockType: current?.blockType ?? null,
      currentPlaylist: current?.playlistName ?? null,
      currentAsset: current?.title ?? null,
      nextBlock: next?.blockLabel ?? null,
      nextBlockType: next?.blockType ?? null,
      nextPlaylist: next?.playlistName ?? null,
      nextAsset: next?.title ?? null,
      windowSegmentIndex: rt ? rt.currentIndex + 1 : undefined,
      windowSegmentCount: rt?.segments.length,
    };
  }

  /** Preview next-window engine state after playlist change (no disk write). */
  async previewFuturePlaylistState(channelId: string): Promise<ChannelWindowBuild | null> {
    return this.buildChannelWindow(channelId, { reason: 'playlist_mutation', deferFutureOnly: true });
  }

  /**
   * Queue playlist mutation for next natural window roll.
   * Active concat + in-memory playback position are untouched.
   */
  applyDeferredPlaylistState(
    channelId: string,
    build: ChannelWindowBuild,
    changeType?: string
  ): void {
    const persisted = this.loadPersistedState(channelId);
    const rt = this.runtimes.get(channelId);
    if (!persisted) return;

    const nextEpoch = (persisted.playbackEpoch ?? 0) + 1;

    this.savePersistedState(channelId, {
      ...persisted,
      playbackEpoch: nextEpoch,
      pendingPlaylistChanges: true,
      pendingChangesAt: new Date().toISOString(),
      pendingNextWindow: {
        engineState: build.engineState,
        scheduleAnchorMs: build.scheduleAnchorMs,
        scheduleCursorMs: build.scheduleCursorMs,
        executionSeed: build.executionSeed,
        windowSegments: build.windowSegments,
        concatContent: build.concatContent,
        concatEntries: build.concatEntries,
        totalDurationSec: build.totalDurationSec,
        windowScheduleStartMs: build.windowScheduleStartMs,
      },
      updatedAt: new Date().toISOString(),
    });

    if (rt) {
      rt.playbackEpoch = nextEpoch;
      rt.updatedAt = Date.now();
    }

    logger.info(
      `[DEFERRED_UPDATE] channelId=${channelId} changeType=${changeType ?? 'other'} ` +
        `appliesAtWindowRoll=true activeConcatUnchanged=true ` +
        `currentIndex=${rt?.currentIndex ?? 0} ` +
        `activeSegments=${rt?.segments.length ?? persisted.windowSegments?.length ?? 0} ` +
        `pendingNextSegments=${build.windowSegments.length} ` +
        `playbackEpoch=${nextEpoch}`
    );
  }

  private segmentToResolved(seg: BlueprintWindowSegment): ResolvedSegment {
    const { videoPath: _vp, playbackDurationSec: _pd, ...resolved } = seg;
    return resolved;
  }

  /** Active window (immutable) + boundary state for future timeline simulation. */
  getTimelineMergeContext(channelId: string): TimelineMergeContext | null {
    const persisted = this.loadPersistedState(channelId);
    const rt = this.runtimes.get(channelId);
    const pinnedSource = rt?.segments.length
      ? rt.segments
      : persisted?.windowSegments?.length
        ? (persisted.windowSegments as BlueprintWindowSegment[])
        : null;
    if (!pinnedSource?.length || !persisted) return null;

    const pinnedSegments = pinnedSource.map((s) => this.segmentToResolved(s));
    const lastPinned = pinnedSegments[pinnedSegments.length - 1];
    const futureStartTime = new Date(lastPinned.endsAt);

    return {
      pinnedSegments,
      futureStartTime,
      futureInitialState: persisted.engineState,
      seed: rt?.executionSeed ?? persisted.executionSeed,
      scheduleAnchorMs: rt?.scheduleAnchorMs ?? persisted.scheduleAnchorMs,
      scheduleCursorMs: rt?.scheduleCursorMs ?? persisted.scheduleCursorMs,
      pendingPlaylistChanges: !!persisted.pendingPlaylistChanges,
    };
  }

  clearPendingPlaylistChanges(channelId: string): boolean {
    const persisted = this.loadPersistedState(channelId);
    if (!persisted?.pendingPlaylistChanges && !persisted?.pendingNextWindow) return false;
    this.savePersistedState(channelId, {
      ...persisted,
      pendingPlaylistChanges: false,
      pendingChangesAt: undefined,
      pendingNextWindow: undefined,
      updatedAt: new Date().toISOString(),
    });
    logger.info(
      `[WINDOW_ROLL_APPLY] channelId=${channelId} pendingChangesApplied=true`
    );
    return true;
  }

  hasPendingPlaylistChanges(channelId: string): boolean {
    return !!this.loadPersistedState(channelId)?.pendingPlaylistChanges;
  }

  private async buildChannelWindow(
    channelId: string,
    options?: { reason?: WindowRefreshReason; deferFutureOnly?: boolean }
  ): Promise<ChannelWindowBuild | null> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { blueprint: true },
    });
    if (!channel?.useBlueprint || !channel.blueprint) return null;

    const blocks = blueprintService.parseBlocksFromJson(channel.blueprint.blocks);
    const playlistIds = blocks.map((b) => b.config?.playlistId).filter(Boolean) as string[];
    const playlists = await blueprintService.loadPlaylistSources(playlistIds);

    const persisted = this.loadPersistedState(channelId);
    const prev = this.runtimes.get(channelId);
    const blueprintChanged =
      (prev && prev.blueprintId !== channel.blueprint.id) ||
      (persisted && persisted.blueprintId !== channel.blueprint.id);

    const executionSeed = blueprintExecutionService.executionSeed(channelId, channel.blueprint.id);
    const now = Date.now();

    let scheduleAnchorMs = blueprintChanged ? now : prev?.scheduleAnchorMs ?? persisted?.scheduleAnchorMs ?? now;
    let scheduleCursorMs = blueprintChanged
      ? scheduleAnchorMs
      : prev?.scheduleCursorMs ?? persisted?.scheduleCursorMs ?? scheduleAnchorMs;

    const rawInitialState = blueprintChanged ? undefined : prev?.engineState ?? persisted?.engineState;
    const initialState = rawInitialState ? migrateCursorState(rawInitialState, blocks) : undefined;

    const deferFutureOnly = !!options?.deferFutureOnly;
    const isLiveMutation =
      !deferFutureOnly &&
      options?.reason === 'playlist_mutation' &&
      !!prev?.streamStartedAt &&
      prev.segments.length > 0;
    const executeStartMs = deferFutureOnly
      ? scheduleCursorMs
      : isLiveMutation
        ? prev!.windowScheduleStartMs ||
          (prev!.segments[0] ? new Date(prev!.segments[0].startsAt).getTime() : scheduleCursorMs)
        : scheduleCursorMs;

    const { segments, state: engineState } = blueprintExecutionService.execute({
      blocks,
      playlists,
      count: this.windowSize,
      startTime: new Date(executeStartMs),
      initialState,
      seed: executionSeed,
      source: 'ENGINE',
    });

    if (segments.length === 0) return null;

    const lastEndMs = new Date(segments[segments.length - 1].endsAt).getTime();
    scheduleCursorMs = lastEndMs;

    const windowSegments: BlueprintWindowSegment[] = [];
    let content = 'ffconcat version 1.0\n';
    const concatEntries: string[] = [];

    for (const seg of segments) {
      const pl = seg.playlistId ? playlists.get(seg.playlistId) : undefined;
      const item = pl?.items.find((i) => i.id === seg.itemId);
      if (!item?.videoPath) continue;
      const probed = await probeMediaDurationSec(item.videoPath);
      const playbackDurationSec = probed ?? item.durationSec ?? seg.durationSec;
      const safePath = item.videoPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
      content += `file '${safePath}'\n`;
      concatEntries.push(item.videoPath);
      windowSegments.push({
        ...seg,
        videoPath: item.videoPath,
        playbackDurationSec,
      });
    }

    if (windowSegments.length === 0) return null;

    const totalDurationSec = windowSegments.reduce(
      (s, seg) => s + (seg.playbackDurationSec ?? seg.durationSec),
      0
    );
    const windowScheduleStartMs = windowSegments[0]
      ? new Date(windowSegments[0].startsAt).getTime()
      : scheduleAnchorMs;

    return {
      channelId,
      blueprintId: channel.blueprint.id,
      windowSegments,
      concatContent: content,
      concatEntries,
      engineState,
      scheduleAnchorMs,
      scheduleCursorMs,
      executionSeed,
      totalDurationSec,
      windowScheduleStartMs,
    };
  }

  async refreshChannelWindow(
    channelId: string,
    options?: { reason?: WindowRefreshReason }
  ): Promise<string | null> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { blueprint: true },
    });
    if (!channel?.useBlueprint || !channel.blueprint) return null;

    const persisted = this.loadPersistedState(channelId);
    const prev = this.runtimes.get(channelId);
    const refreshReason: WindowRefreshReason =
      options?.reason ??
      (prev && persisted?.blueprintId === channel.blueprint.id ? 'window_roll' : 'window_refresh');

    let build: ChannelWindowBuild | null = null;
    if (refreshReason === 'window_roll' && persisted?.pendingNextWindow) {
      const pending = persisted.pendingNextWindow;
      build = {
        channelId,
        blueprintId: channel.blueprint.id,
        windowSegments: pending.windowSegments,
        concatContent: pending.concatContent,
        concatEntries: pending.concatEntries,
        engineState: pending.engineState,
        scheduleAnchorMs: pending.scheduleAnchorMs,
        scheduleCursorMs: pending.scheduleCursorMs,
        executionSeed: pending.executionSeed,
        totalDurationSec: pending.totalDurationSec,
        windowScheduleStartMs: pending.windowScheduleStartMs,
      };
      logger.info(
        `[WINDOW_ROLL_APPLY] channelId=${channelId} source=pendingNextWindow ` +
          `segments=${build.windowSegments.length}`
      );
    } else {
      build = await this.buildChannelWindow(channelId, options);
    }

    const filePath = this.getBlueprintConcatPath(channelId);
    if (!build) {
      logger.error(`[EXECUTION_ERROR] blockType=window media=none error=No segments generated channelId=${channelId}`);
      this.runtimes.delete(channelId);
      this.clearPersistedState(channelId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return null;
    }

    const blueprintChanged =
      (prev && prev.blueprintId !== channel.blueprint.id) ||
      (persisted && persisted.blueprintId !== channel.blueprint.id);

    fs.writeFileSync(filePath, build.concatContent, 'utf8');

    const windowsEmitted = (blueprintChanged ? 0 : persisted?.windowsEmitted ?? 0) + 1;
    const isWindowRoll = !blueprintChanged && !!prev && options?.reason !== 'playlist_mutation';
    const resolvedReason: WindowRefreshReason =
      refreshReason === 'window_roll' || isWindowRoll
        ? 'window_roll'
        : blueprintChanged
          ? 'blueprint_changed'
          : options?.reason ?? 'window_refresh';
    const shouldBumpEpoch =
      resolvedReason === 'window_roll' ||
      resolvedReason === 'blueprint_changed' ||
      resolvedReason === 'playlist_mutation';
    const nextPlaybackEpoch = (persisted?.playbackEpoch ?? 0) + (shouldBumpEpoch ? 1 : 0);
    const beforeSnap = { phase: 'refresh_before', channelId };

    const newRuntime: BlueprintPlaybackRuntime = {
      channelId,
      blueprintId: channel.blueprint.id,
      blueprintName: channel.blueprint.name,
      segments: build.windowSegments,
      totalDurationSec: build.totalDurationSec,
      streamStartedAt: blueprintChanged ? null : prev?.streamStartedAt ?? null,
      currentIndex: 0,
      engineSegmentIndex: 0,
      activePlaybackTimeSec: 0,
      segmentOffsetSec: 0,
      windowScheduleStartMs: build.windowScheduleStartMs,
      updatedAt: Date.now(),
      engineState: build.engineState,
      scheduleAnchorMs: build.scheduleAnchorMs,
      scheduleCursorMs: build.scheduleCursorMs,
      executionSeed: build.executionSeed,
      channelSlug: channel.slug,
      playbackEpoch: nextPlaybackEpoch,
    };
    this.runtimes.set(channelId, newRuntime);
    this.logWindowReset(
      channelId,
      newRuntime,
      resolvedReason === 'playlist_mutation'
        ? 'playlist_mutation'
        : resolvedReason === 'window_roll'
          ? 'window_roll'
          : blueprintChanged
            ? 'blueprint_changed'
            : 'window_refresh'
    );

    if (shouldBumpEpoch) {
      const invalidateReason =
        resolvedReason === 'playlist_mutation'
          ? 'PLAYLIST_MUTATION'
          : resolvedReason === 'window_roll'
            ? 'WINDOW_ROLL'
            : 'BLUEPRINT_CHANGE';
      blueprintService.invalidateTimelineCaches(channel.blueprint.id, invalidateReason);
      logger.info(
        `[TIMELINE_EPOCH] channelId=${channelId} blueprintId=${channel.blueprint.id} ` +
          `playbackEpoch=${nextPlaybackEpoch} prevEpoch=${persisted?.playbackEpoch ?? 0} ` +
          `reason=${resolvedReason} windowsEmitted=${windowsEmitted}`
      );
      if (resolvedReason !== 'playlist_mutation') {
        void blueprintService.regenerateTimelineCacheForChannel(channel.blueprint.id, channelId);
      }
    }

    const playlistIds = blueprintService
      .parseBlocksFromJson(channel.blueprint.blocks)
      .map((b) => b.config?.playlistId)
      .filter(Boolean) as string[];

    this.savePersistedState(channelId, {
      blueprintId: channel.blueprint.id,
      engineState: build.engineState,
      scheduleAnchorMs: build.scheduleAnchorMs,
      scheduleCursorMs: build.scheduleCursorMs,
      windowsEmitted,
      executionSeed: build.executionSeed,
      playbackEpoch: nextPlaybackEpoch,
      streamStartedAt: blueprintChanged ? null : prev?.streamStartedAt ?? persisted?.streamStartedAt ?? null,
      windowSegments: build.windowSegments.map(({ videoPath: _vp, playbackDurationSec, ...seg }) => ({
        ...seg,
        playbackDurationSec,
      })),
      pendingPlaylistChanges: false,
      pendingChangesAt: undefined,
      pendingNextWindow: undefined,
      updatedAt: new Date().toISOString(),
    });

    logger.info(`[WINDOW_REFRESH] channelId=${channelId} before=${JSON.stringify(beforeSnap)} segments=${build.windowSegments.length}`);

    logger.info(
      `[WINDOW_REBUILD] channelId=${channelId} windowRebuilt=true segments=${build.windowSegments.length} ` +
        `playbackEpoch=${nextPlaybackEpoch} blueprintChanged=${blueprintChanged} isWindowRoll=${resolvedReason === 'window_roll'}`
    );
    blueprintWindowAuditService.logBlueprintState({
      channelId,
      blueprintId: channel.blueprint.id,
      playlistIds,
    });
    blueprintWindowAuditService.logWindowContent(channelId, 0, 'runtime_window');
    blueprintWindowAuditService.logWindowContent(channelId, 0, 'concat_file');

    return filePath;
  }

  clearRuntime(channelId: string): void {
    const rt = this.runtimes.get(channelId);
    const persisted = this.loadPersistedState(channelId);
    const blueprintId = rt?.blueprintId ?? persisted?.blueprintId;
    if (blueprintId) {
      blueprintService.invalidateTimelineCaches(blueprintId, 'CHANNEL_RESTART');
    }
    playbackSyncService.stopMonitoring(channelId);
    this.runtimes.delete(channelId);
    this.clearPersistedState(channelId);
  }
}

export const blueprintPlaybackService = new BlueprintPlaybackService();
