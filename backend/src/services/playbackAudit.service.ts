/**
 * Playback synchronization audit — instrumentation ONLY.
 * Does not modify timeline, lag, schedule, or cursor mapping logic.
 */
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import { HLS_VIEWER_LATENCY_SEC } from './hlsTiming.service';

export interface RuntimeCursorSnapshot {
  phase: string;
  channelId: string;
  timestamp: string;
  rawFfmpegTimeSec: number | null;
  ffmpegTimeSec: number | null;
  visibleTimeSec: number | null;
  currentIndex: number | null;
  engineSegmentIndex: number | null;
  segmentOffsetSec: number | null;
  totalDurationSec: number | null;
  windowScheduleStartMs: number | null;
  scheduleCursorMs: number | null;
  scheduleAnchorMs: number | null;
  windowsEmitted: number | null;
  playbackElapsedSecPersisted: number | null;
  currentIndexPersisted: number | null;
  visibleMedia: string | null;
  engineMedia: string | null;
  ffmpegLiveTimeSec: number | null;
  totalLagSecReported: number | null;
  windowMediaSec: number | null;
}

const LAG_DEBUG_INTERVAL_MS = 10_000;
const lastLagDebug = new Map<string, number>();
const rolloverBefore = new Map<string, RuntimeCursorSnapshot>();

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return n.toFixed(2);
}

function snapLine(s: RuntimeCursorSnapshot): string {
  return (
    `phase=${s.phase} channelId=${s.channelId} ` +
    `rawFfmpegTimeSec=${fmt(s.rawFfmpegTimeSec)} ffmpegTimeSec=${fmt(s.ffmpegTimeSec)} ` +
    `visibleTimeSec=${fmt(s.visibleTimeSec)} currentIndex=${s.currentIndex ?? 'n/a'} ` +
    `engineIndex=${s.engineSegmentIndex ?? 'n/a'} visibleMedia=${s.visibleMedia ?? 'none'} ` +
    `engineMedia=${s.engineMedia ?? 'none'} ` +
    `persistedElapsed=${fmt(s.playbackElapsedSecPersisted)} persistedIndex=${s.currentIndexPersisted ?? 'n/a'} ` +
    `scheduleCursorMs=${s.scheduleCursorMs ?? 'n/a'} windowsEmitted=${s.windowsEmitted ?? 'n/a'}`
  );
}

class PlaybackAuditService {
  captureRuntimeSnapshot(
    phase: string,
    channelId: string,
    rt?: {
      rawFfmpegTimeSec?: number;
      ffmpegTimeSec?: number;
      visibleTimeSec?: number;
      currentIndex?: number;
      engineSegmentIndex?: number;
      segmentOffsetSec?: number;
      totalDurationSec?: number;
      windowScheduleStartMs?: number;
      scheduleCursorMs?: number;
      scheduleAnchorMs?: number;
      segments?: Array<{ title: string }>;
    } | null,
    persisted?: {
      playbackElapsedSec?: number;
      currentIndex?: number;
      scheduleCursorMs?: number;
      scheduleAnchorMs?: number;
      windowsEmitted?: number;
    } | null
  ): RuntimeCursorSnapshot {
    const proc = ffmpegService.getProcessInfo(channelId);
    const ffmpegLive =
      typeof proc?.stats.timeSec === 'number' && proc.stats.timeSec >= 0
        ? proc.stats.timeSec
        : null;

    return {
      phase,
      channelId,
      timestamp: new Date().toISOString(),
      rawFfmpegTimeSec: rt?.rawFfmpegTimeSec ?? null,
      ffmpegTimeSec: rt?.ffmpegTimeSec ?? null,
      visibleTimeSec: rt?.visibleTimeSec ?? null,
      currentIndex: rt?.currentIndex ?? null,
      engineSegmentIndex: rt?.engineSegmentIndex ?? null,
      segmentOffsetSec: rt?.segmentOffsetSec ?? null,
      totalDurationSec: rt?.totalDurationSec ?? null,
      windowScheduleStartMs: rt?.windowScheduleStartMs ?? null,
      scheduleCursorMs: rt?.scheduleCursorMs ?? persisted?.scheduleCursorMs ?? null,
      scheduleAnchorMs: rt?.scheduleAnchorMs ?? persisted?.scheduleAnchorMs ?? null,
      windowsEmitted: persisted?.windowsEmitted ?? null,
      playbackElapsedSecPersisted: persisted?.playbackElapsedSec ?? null,
      currentIndexPersisted: persisted?.currentIndex ?? null,
      visibleMedia: rt?.segments?.[rt.currentIndex ?? -1]?.title ?? null,
      engineMedia: rt?.segments?.[rt.engineSegmentIndex ?? -1]?.title ?? null,
      ffmpegLiveTimeSec: ffmpegLive,
      totalLagSecReported: null,
      windowMediaSec: rt?.ffmpegTimeSec ?? null,
    };
  }

  logTransition(channelId: string, event: string, before: RuntimeCursorSnapshot, after: RuntimeCursorSnapshot): void {
    logger.info(`[WINDOW_ROLL] event=${event} channelId=${channelId}`);
    logger.info(`[WINDOW_ROLL] BEFORE ${snapLine(before)}`);
    logger.info(`[WINDOW_ROLL] AFTER  ${snapLine(after)}`);

    const monotonic: string[] = [];
    if (
      before.rawFfmpegTimeSec != null &&
      after.rawFfmpegTimeSec != null &&
      after.rawFfmpegTimeSec > before.rawFfmpegTimeSec + 1 &&
      event.includes('restore')
    ) {
      monotonic.push(`rawFfmpegTimeSec increased ${before.rawFfmpegTimeSec}→${after.rawFfmpegTimeSec} across restart`);
    }
    if (
      before.playbackElapsedSecPersisted != null &&
      after.playbackElapsedSecPersisted != null &&
      after.playbackElapsedSecPersisted > before.playbackElapsedSecPersisted + 1 &&
      event.includes('refresh')
    ) {
      monotonic.push(
        `playbackElapsedSec persisted increased ${before.playbackElapsedSecPersisted}→${after.playbackElapsedSecPersisted}`
      );
    }
    if (monotonic.length) {
      logger.warn(`[ROLLOVER_MONOTONIC_BUG] channelId=${channelId} ${monotonic.join('; ')}`);
    }
  }

  /** Call immediately before FFmpeg stop / window refresh */
  logRolloverState(
    channelId: string,
    rt?: Parameters<PlaybackAuditService['captureRuntimeSnapshot']>[2],
    persisted?: Parameters<PlaybackAuditService['captureRuntimeSnapshot']>[3]
  ): void {
    const snap = this.captureRuntimeSnapshot('rollover_before', channelId, rt, persisted);
    rolloverBefore.set(channelId, snap);
    logger.info(`[ROLLOVER_STATE] ${snapLine(snap)}`);
  }

  /** Call after FFmpeg start / runtime restore */
  logRolloverRestore(
    channelId: string,
    rt?: Parameters<PlaybackAuditService['captureRuntimeSnapshot']>[2],
    persisted?: Parameters<PlaybackAuditService['captureRuntimeSnapshot']>[3]
  ): void {
    const after = this.captureRuntimeSnapshot('rollover_after', channelId, rt, persisted);
    logger.info(`[ROLLOVER_RESTORE] ${snapLine(after)}`);
    const before = rolloverBefore.get(channelId);
    if (before) {
      this.logTransition(channelId, 'ffmpeg_restart_restore', before, after);
      rolloverBefore.delete(channelId);
    }
  }

  /**
   * [LAG_DEBUG] every 10s — reports whether lag metrics are fresh vs stale.
   * totalLagSecSource: 'constant' | 'computed' | 'stale_runtime'
   */
  maybeLogLagDebug(
    channelId: string,
    params: {
      ffmpegTimeSec: number;
      visibleTimeSec: number;
      totalLagSec: number;
      windowMediaSec: number;
      currentIndex: number;
      windowDurationSec: number;
      rawFfmpegTimeSec: number;
      inputSource: 'ffmpeg_stderr' | 'poll_reuse_raw' | 'hydrate_persisted';
    }
  ): void {
    const now = Date.now();
    const last = lastLagDebug.get(channelId) ?? 0;
    if (now - last < LAG_DEBUG_INTERVAL_MS) return;
    lastLagDebug.set(channelId, now);

    const proc = ffmpegService.getProcessInfo(channelId);
    const ffmpegLive =
      typeof proc?.stats.timeSec === 'number' && proc.stats.timeSec >= 0
        ? proc.stats.timeSec
        : null;
    const effectiveLag = params.windowMediaSec - params.visibleTimeSec;
    const ffmpegStaleSec =
      ffmpegLive != null ? ffmpegLive - params.rawFfmpegTimeSec : null;

    let totalLagSecSource: 'constant' | 'computed_effective' | 'stale_runtime' = 'constant';
    if (Math.abs(params.totalLagSec - HLS_VIEWER_LATENCY_SEC) > 0.5) {
      totalLagSecSource = 'stale_runtime';
    }
    if (Math.abs(effectiveLag - params.totalLagSec) > 2) {
      totalLagSecSource = 'computed_effective';
    }

    logger.info(
      `[LAG_DEBUG] channelId=${channelId} ` +
        `ffmpegTimeSec=${fmt(params.ffmpegTimeSec)} visibleTimeSec=${fmt(params.visibleTimeSec)} ` +
        `totalLagSec=${fmt(params.totalLagSec)} effectiveLag=${fmt(effectiveLag)} ` +
        `windowMediaSec=${fmt(params.windowMediaSec)} currentIndex=${params.currentIndex} ` +
        `windowDurationSec=${fmt(params.windowDurationSec)} rawFfmpegTimeSec=${fmt(params.rawFfmpegTimeSec)} ` +
        `ffmpegLiveTimeSec=${fmt(ffmpegLive)} ffmpegStaleSec=${fmt(ffmpegStaleSec)} ` +
        `inputSource=${params.inputSource} totalLagSecSource=${totalLagSecSource} ` +
        `constantBuffer=${HLS_VIEWER_LATENCY_SEC}`
    );

    if (ffmpegStaleSec != null && ffmpegStaleSec > 5) {
      logger.warn(
        `[LAG_DEBUG] STALE_INPUT channelId=${channelId} poll/ffmpeg gap=${fmt(ffmpegStaleSec)}s ` +
          `— visibleTimeSec frozen while FFmpeg advances`
      );
    }
    if (effectiveLag > HLS_VIEWER_LATENCY_SEC + 10) {
      logger.warn(
        `[LAG_DEBUG] EFFECTIVE_LAG_GROWTH channelId=${channelId} effectiveLag=${fmt(effectiveLag)}s ` +
          `(windowMediaSec - visibleTimeSec) exceeds constant buffer ${HLS_VIEWER_LATENCY_SEC}s`
      );
    }
  }

  clearChannel(channelId: string): void {
    lastLagDebug.delete(channelId);
    rolloverBefore.delete(channelId);
  }
}

export const playbackAuditService = new PlaybackAuditService();
