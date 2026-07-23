import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import { HLS_VIEWER_LATENCY_SEC } from './hlsTiming.service';
import type { BlueprintLiveCursor } from '../types/blueprint.types';

interface TimingSlice {
  rawFfmpegTimeSec?: number;
  windowMediaSec?: number;
  ffmpegTimeSec?: number;
  visibleTimeSec?: number;
  hlsLiveEdgeSec?: number | null;
  hlsVisibleSec?: number | null;
  hlsVisibleSegmentIndex?: number | null;
  hlsLatestSegmentIndex?: number | null;
  hlsSessionSegmentCount?: number;
  visibleSource?: 'hls' | 'fallback';
  engineWindowIndex?: number;
  visibleWindowIndex?: number;
  visibleScheduleMs?: number | null;
}

const PIPELINE_LOG_INTERVAL_MS = 5000;
const STALL_THRESHOLD_MS = 20_000;
const STALL_POSITION_DELTA_SEC = 3;

export interface PipelineForensicsSnapshot {
  channelId: string;
  blueprintId: string;
  timestamp: string;
  blueprintMedia: string | null;
  engineMedia: string | null;
  ffmpegMedia: string | null;
  hlsMedia: string | null;
  liveCursorMedia: string | null;
  timelineMedia: string | null;
  nowPlayingMedia: string | null;
  previewMedia: string | null;
  blueprintIndex: number | null;
  engineIndex: number | null;
  hlsIndex: number | null;
  timelineIndex: number | null;
  ffmpegTimeSec: number | null;
  ffmpegLiveTimeSec: number | null;
  rawFfmpegTimeSec: number | null;
  windowMediaSec: number | null;
  visibleTimeSec: number | null;
  totalLagSec: number;
  ffmpegStaleSec: number | null;
  timelineSource: 'request' | 'cache' | 'none';
}

interface ChannelHeartbeat {
  lastMedia: string | null;
  lastIndex: number | null;
  lastPositionSec: number | null;
  lastFfmpegLiveSec: number | null;
  lastAdvanceMs: number;
  lastPipelineLogMs: number;
  stallEmitted: boolean;
}

interface RestartCapture {
  capturedAt: string;
  previousWindowMedia: string | null;
  previousEngineMedia: string | null;
  previousVisibleMedia: string | null;
  previousEngineIndex: number | null;
  previousRawFfmpegSec: number | null;
  windowsEmitted: number | null;
}

class PipelineForensicsService {
  private readonly heartbeats = new Map<string, ChannelHeartbeat>();
  private readonly restartCaptures = new Map<string, RestartCapture>();
  private readonly lastPipelineLog = new Map<string, number>();

  /** Call before stop/clearRuntime to snapshot pre-restart state */
  captureBeforeRestart(
    channelId: string,
    runtime?: {
      segments: Array<{ title: string }>;
      engineSegmentIndex: number;
      currentIndex: number;
      activePlaybackTimeSec: number;
    } | null,
    windowsEmitted?: number
  ): void {
    const engineSeg = runtime?.segments[runtime.engineSegmentIndex];
    const visibleSeg = runtime?.segments[runtime.currentIndex];
    this.restartCaptures.set(channelId, {
      capturedAt: new Date().toISOString(),
      previousWindowMedia: visibleSeg?.title ?? engineSeg?.title ?? null,
      previousEngineMedia: engineSeg?.title ?? null,
      previousVisibleMedia: visibleSeg?.title ?? null,
      previousEngineIndex: runtime?.engineSegmentIndex ?? null,
      previousRawFfmpegSec: runtime?.activePlaybackTimeSec ?? null,
      windowsEmitted: windowsEmitted ?? null,
    });
  }

  logChannelRestart(
    channelId: string,
    newState?: {
      firstSegmentTitle?: string | null;
      engineIndex?: number;
      windowsEmitted?: number;
    }
  ): void {
    const prev = this.restartCaptures.get(channelId);
    logger.info(
      `[CHANNEL_RESTART] channelId=${channelId} ` +
        `previousMedia=${prev?.previousVisibleMedia ?? prev?.previousEngineMedia ?? 'unknown'} ` +
        `previousWindow=${prev?.windowsEmitted ?? 'n/a'} ` +
        `previousRawFfmpegSec=${prev?.previousRawFfmpegSec?.toFixed(2) ?? 'n/a'} ` +
        `newMedia=${newState?.firstSegmentTitle ?? 'pending'} ` +
        `newWindow=${newState?.windowsEmitted ?? 'n/a'} ` +
        `capturedAt=${prev?.capturedAt ?? 'n/a'}`
    );
    this.restartCaptures.delete(channelId);
    this.heartbeats.delete(channelId);
    this.lastPipelineLog.delete(channelId);
  }

  logPlaybackHeartbeat(params: {
    channelId: string;
    currentMedia: string | null;
    currentIndex: number;
    currentPosition: number;
    windowId?: number | null;
    playlistId?: string | null;
    segmentId?: string | null;
  }): void {
    logger.info(
      `[PLAYBACK_HEARTBEAT] channelId=${params.channelId} ` +
        `currentMedia=${params.currentMedia ?? 'none'} currentIndex=${params.currentIndex} ` +
        `currentPosition=${params.currentPosition.toFixed(2)} ` +
        `windowId=${params.windowId ?? 'n/a'} playlistId=${params.playlistId ?? 'n/a'} ` +
        `segmentId=${params.segmentId ?? 'n/a'}`
    );
    this.updateHeartbeat(params.channelId, {
      media: params.currentMedia,
      index: params.currentIndex,
      positionSec: params.currentPosition,
      ffmpegLiveSec: null,
    });
  }

  runLiveCursorForensics(params: {
    channelId: string;
    blueprintId: string;
    cursor: {
      engine: BlueprintLiveCursor['engine'];
      visible: BlueprintLiveCursor['visible'];
      timing: TimingSlice | null;
    };
    timelineIndex: number | null;
    timelineSegment: BlueprintLiveCursor['timelineSegment'];
    timelineSource: 'request' | 'cache' | 'none';
    windowSegments: Array<{ title: string; itemId: string | null; playlistId: string | null }>;
    nowPlayingMedia: string | null;
    windowsEmitted?: number;
  }): PipelineForensicsSnapshot {
    const proc = ffmpegService.getProcessInfo(params.channelId);
    const ffmpegLiveTimeSec =
      typeof proc?.stats.timeSec === 'number' && proc.stats.timeSec >= 0 ? proc.stats.timeSec : null;
    const timing = params.cursor.timing;
    const rawFfmpeg = timing?.rawFfmpegTimeSec ?? null;
    const ffmpegStaleSec =
      ffmpegLiveTimeSec != null && rawFfmpeg != null ? ffmpegLiveTimeSec - rawFfmpeg : null;

    const hlsIdx = timing?.hlsVisibleSegmentIndex ?? null;
    const engineIdx = timing?.engineWindowIndex ?? params.cursor.engine?.windowIndex ?? null;
    const visibleIdx = timing?.visibleWindowIndex ?? params.cursor.visible?.windowIndex ?? null;

    const snapshot: PipelineForensicsSnapshot = {
      channelId: params.channelId,
      blueprintId: params.blueprintId,
      timestamp: new Date().toISOString(),
      blueprintMedia: params.windowSegments[visibleIdx ?? 0]?.title ?? null,
      engineMedia: params.cursor.engine?.title ?? null,
      ffmpegMedia: params.cursor.engine?.title ?? null,
      hlsMedia: params.cursor.visible?.title ?? null,
      liveCursorMedia: params.cursor.visible?.title ?? null,
      timelineMedia: params.timelineSegment?.title ?? null,
      nowPlayingMedia: params.nowPlayingMedia,
      previewMedia: params.cursor.visible?.title ?? null,
      blueprintIndex: visibleIdx,
      engineIndex: engineIdx,
      hlsIndex: hlsIdx,
      timelineIndex: params.timelineIndex,
      ffmpegTimeSec: timing?.ffmpegTimeSec ?? null,
      ffmpegLiveTimeSec,
      rawFfmpegTimeSec: rawFfmpeg,
      windowMediaSec: timing?.windowMediaSec ?? null,
      visibleTimeSec: timing?.visibleTimeSec ?? null,
      totalLagSec: HLS_VIEWER_LATENCY_SEC,
      ffmpegStaleSec,
      timelineSource: params.timelineSource,
    };

    this.logHlsState(params.channelId, timing);
    this.logTimelineState(params.channelId, params.timelineSegment, params.timelineIndex, timing);
    this.logNowPlayingState(params.channelId, params.nowPlayingMedia, params.cursor.visible?.itemId ?? null);

    this.updateHeartbeat(params.channelId, {
      media: params.cursor.visible?.title ?? null,
      index: visibleIdx,
      positionSec: timing?.visibleTimeSec ?? null,
      ffmpegLiveSec: ffmpegLiveTimeSec,
    });

    this.checkStalls(params.channelId, snapshot, proc?.stats.timeSec);
    this.maybeLogPipelineState(snapshot);

    return snapshot;
  }

  private logHlsState(channelId: string, timing: TimingSlice | null): void {
    if (!timing) return;
    logger.info(
      `[HLS_STATE] channelId=${channelId} ` +
        `playlistSequence=n/a latestSegment=${timing.hlsLatestSegmentIndex ?? 'n/a'} ` +
        `visibleSegment=${timing.hlsVisibleSegmentIndex ?? 'n/a'} segmentCount=${timing.hlsSessionSegmentCount} ` +
        `liveEdgeSec=${timing.hlsLiveEdgeSec?.toFixed(2) ?? 'n/a'} ` +
        `visibleSec=${timing.hlsVisibleSec?.toFixed(2) ?? 'n/a'} ` +
        `programDateTime=n/a playlistReloadTime=${new Date().toISOString()} ` +
        `source=${timing.visibleSource}`
    );
  }

  private logTimelineState(
    channelId: string,
    segment: BlueprintLiveCursor['timelineSegment'],
    index: number | null,
    timing: TimingSlice | null
  ): void {
    logger.info(
      `[TIMELINE_STATE] channelId=${channelId} ` +
        `currentSegment=${segment?.title ?? 'none'} segmentIndex=${index ?? 'n/a'} ` +
        `segmentStart=${segment?.startsAt ?? 'n/a'} segmentEnd=${segment?.endsAt ?? 'n/a'} ` +
        `visibleScheduleMs=${timing?.visibleScheduleMs ?? 'n/a'}`
    );
  }

  private logNowPlayingState(channelId: string, media: string | null, mediaId: string | null): void {
    logger.info(
      `[NOW_PLAYING_STATE] channelId=${channelId} currentMedia=${media ?? 'none'} ` +
        `mediaId=${mediaId ?? 'n/a'} source=monitoring/health/getDiagnostics`
    );
  }

  private maybeLogPipelineState(snapshot: PipelineForensicsSnapshot): void {
    const now = Date.now();
    const last = this.lastPipelineLog.get(snapshot.channelId) ?? 0;
    if (now - last < PIPELINE_LOG_INTERVAL_MS) return;
    this.lastPipelineLog.set(snapshot.channelId, now);

    logger.info(
      `[PIPELINE_STATE] channelId=${snapshot.channelId} timestamp=${snapshot.timestamp} ` +
        `blueprintMedia=${snapshot.blueprintMedia ?? 'none'} engineMedia=${snapshot.engineMedia ?? 'none'} ` +
        `ffmpegMedia=${snapshot.ffmpegMedia ?? 'none'} hlsMedia=${snapshot.hlsMedia ?? 'none'} ` +
        `liveCursorMedia=${snapshot.liveCursorMedia ?? 'none'} timelineMedia=${snapshot.timelineMedia ?? 'none'} ` +
        `nowPlayingMedia=${snapshot.nowPlayingMedia ?? 'none'} previewMedia=${snapshot.previewMedia ?? 'none'} ` +
        `blueprintIndex=${snapshot.blueprintIndex ?? 'n/a'} engineIndex=${snapshot.engineIndex ?? 'n/a'} ` +
        `hlsIndex=${snapshot.hlsIndex ?? 'n/a'} timelineIndex=${snapshot.timelineIndex ?? 'n/a'} ` +
        `ffmpegTimeSec=${snapshot.ffmpegTimeSec?.toFixed(2) ?? 'n/a'} ` +
        `ffmpegLiveTimeSec=${snapshot.ffmpegLiveTimeSec?.toFixed(2) ?? 'n/a'} ` +
        `rawFfmpegTimeSec=${snapshot.rawFfmpegTimeSec?.toFixed(2) ?? 'n/a'} ` +
        `windowMediaSec=${snapshot.windowMediaSec?.toFixed(2) ?? 'n/a'} ` +
        `visibleTimeSec=${snapshot.visibleTimeSec?.toFixed(2) ?? 'n/a'} ` +
        `totalLagSec=${snapshot.totalLagSec} ffmpegStaleSec=${snapshot.ffmpegStaleSec?.toFixed(2) ?? 'n/a'} ` +
        `timelineSource=${snapshot.timelineSource}`
    );

    if (snapshot.ffmpegStaleSec != null && snapshot.ffmpegStaleSec > STALL_POSITION_DELTA_SEC) {
      logger.warn(
        `[FFMPEG_CURSOR_STALE] channelId=${snapshot.channelId} ` +
          `ffmpegLive=${snapshot.ffmpegLiveTimeSec?.toFixed(2)} storedRaw=${snapshot.rawFfmpegTimeSec?.toFixed(2)} ` +
          `staleBy=${snapshot.ffmpegStaleSec.toFixed(2)}s — live-cursor polls reuse stale rawFfmpegTimeSec`
      );
    }
  }

  private updateHeartbeat(
    channelId: string,
    update: {
      media: string | null;
      index: number | null;
      positionSec: number | null;
      ffmpegLiveSec: number | null;
    }
  ): void {
    const prev = this.heartbeats.get(channelId);
    const now = Date.now();
    const positionChanged =
      update.media !== prev?.lastMedia ||
      update.index !== prev?.lastIndex ||
      (update.positionSec != null &&
        prev?.lastPositionSec != null &&
        Math.abs(update.positionSec - prev.lastPositionSec) > 0.5);

    this.heartbeats.set(channelId, {
      lastMedia: update.media,
      lastIndex: update.index,
      lastPositionSec: update.positionSec,
      lastFfmpegLiveSec: update.ffmpegLiveSec ?? prev?.lastFfmpegLiveSec ?? null,
      lastAdvanceMs: positionChanged ? now : (prev?.lastAdvanceMs ?? now),
      lastPipelineLogMs: prev?.lastPipelineLogMs ?? 0,
      stallEmitted: positionChanged ? false : (prev?.stallEmitted ?? false),
    });
  }

  private checkStalls(
    channelId: string,
    snapshot: PipelineForensicsSnapshot,
    ffmpegLiveSec?: number
  ): void {
    const hb = this.heartbeats.get(channelId);
    if (!hb || hb.stallEmitted) return;

    const now = Date.now();
    const stalledMs = now - hb.lastAdvanceMs;
    const ffmpegAdvanced =
      ffmpegLiveSec != null &&
      hb.lastFfmpegLiveSec != null &&
      ffmpegLiveSec - hb.lastFfmpegLiveSec >= STALL_POSITION_DELTA_SEC;

    if (stalledMs < STALL_THRESHOLD_MS) return;
    if (!ffmpegAdvanced && snapshot.ffmpegLiveTimeSec == null) return;

    hb.stallEmitted = true;
    logger.warn(
      `[STATE_STALL] channelId=${channelId} stalledMs=${stalledMs} ` +
        `lastMedia=${hb.lastMedia ?? 'none'} lastIndex=${hb.lastIndex ?? 'n/a'} ` +
        `lastPosition=${hb.lastPositionSec?.toFixed(2) ?? 'n/a'} ` +
        `ffmpegLiveSec=${snapshot.ffmpegLiveTimeSec?.toFixed(2) ?? 'n/a'} ` +
        `visibleTimeSec=${snapshot.visibleTimeSec?.toFixed(2) ?? 'n/a'}`
    );

    if (
      snapshot.hlsIndex != null &&
      snapshot.engineIndex != null &&
      ffmpegAdvanced &&
      snapshot.hlsIndex === hb.lastIndex
    ) {
      logger.warn(
        `[HLS_CURSOR_STALLED] channelId=${channelId} playlistAdvancing=true visibleSegmentStuck=${snapshot.hlsIndex}`
      );
    }

    if (
      snapshot.timelineMedia &&
      snapshot.liveCursorMedia &&
      snapshot.timelineMedia !== snapshot.liveCursorMedia
    ) {
      logger.warn(`[Timeline Frozen] channelId=${channelId} playbackChanged timelineStuck=${snapshot.timelineMedia}`);
    }
  }

  detectTimelineFrozen(
    channelId: string,
    prevIndex: number | null,
    nextIndex: number | null,
    liveMedia: string | null,
    timelineMedia: string | null
  ): void {
    if (liveMedia && timelineMedia && liveMedia !== timelineMedia && prevIndex === nextIndex) {
      logger.warn(
        `[Timeline Frozen] channelId=${channelId} liveMedia=${liveMedia} timelineMedia=${timelineMedia} ` +
          `stuckIndex=${nextIndex ?? 'n/a'}`
      );
    }
  }
}

export const pipelineForensicsService = new PipelineForensicsService();
