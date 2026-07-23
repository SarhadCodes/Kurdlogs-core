/**
 * Source-transition investigation — instrumentation ONLY.
 *
 * currentIndex advances ONLY inside blueprintPlayback.applyPlaybackTiming():
 *   findIndexAtElapsed(rt, visibleTimeSec)
 *
 * visibleTimeSec is derived from:
 *   - FFmpeg stderr time= → windowMediaSec (via getActiveFfmpegTimecode)
 *   - HLS m3u8 live edge → visibleConcatSec (hlsTiming.resolvePlaybackTiming)
 *
 * Transition triggers:
 *   1. Video end        — FFmpeg stderr time= crosses segment duration (ffprobe playbackDurationSec)
 *   2. Playlist advance — same path; blockId may stay same, itemId changes
 *   3. Blueprint block  — blockId changes when elapsed crosses block boundary in window
 *   4. Window rollover  — refreshChannelWindow + markWindowRolled zeros index; new concat file
 *
 * currentIndex does NOT use scheduleCursorMs directly — schedule is for timeline generation only.
 */
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import {
  HLS_ENCODE_LEAD_SEC,
  HLS_VIEWER_LATENCY_SEC,
  parseHlsVariantPlaylist,
  resolveHlsIndexPath,
} from './hlsTiming.service';
import { env } from '../config/env';

export type TransitionInputSource =
  | 'ffmpeg_stderr'
  | 'observer_poll'
  | 'window_roll'
  | 'stream_started'
  | 'hydrate'
  | 'window_refresh';

export type TransitionCause =
  | 'video_end'
  | 'playlist_advance'
  | 'blueprint_block_change'
  | 'window_rollover'
  | 'unknown';

interface SegmentLike {
  title: string;
  blockId?: string;
  itemId?: string | null;
  playbackDurationSec?: number;
  durationSec: number;
}

interface ChannelMonitor {
  blueprintId: string;
  interval: ReturnType<typeof setInterval>;
}

const MEDIA_STATE_INTERVAL_MS = 5000;
const TRANSITION_MISS_GRACE_MS = 2000;

function segmentDurationSec(seg: SegmentLike): number {
  const d = seg.playbackDurationSec ?? seg.durationSec;
  return Number.isFinite(d) && d > 0 ? d : 120;
}

function findIndexAtElapsed(
  segments: SegmentLike[],
  elapsedSec: number
): { index: number; offsetSec: number; title: string | null } {
  if (segments.length === 0) return { index: 0, offsetSec: 0, title: null };

  const total = segments.reduce((s, seg) => s + segmentDurationSec(seg), 0);
  if (total <= 0) return { index: 0, offsetSec: 0, title: segments[0]?.title ?? null };

  let remaining = elapsedSec;
  if (remaining >= total) remaining = remaining % total;

  for (let i = 0; i < segments.length; i++) {
    const dur = segmentDurationSec(segments[i]);
    if (remaining < dur) {
      return { index: i, offsetSec: remaining, title: segments[i].title };
    }
    remaining -= dur;
  }
  return { index: 0, offsetSec: 0, title: segments[0]?.title ?? null };
}

function inferTransitionCause(
  prev: SegmentLike | undefined,
  next: SegmentLike | undefined,
  inputSource: TransitionInputSource
): TransitionCause {
  if (inputSource === 'window_roll' || inputSource === 'stream_started') return 'window_rollover';
  if (!prev || !next) return 'unknown';
  if (prev.blockId && next.blockId && prev.blockId !== next.blockId) return 'blueprint_block_change';
  if (prev.itemId && next.itemId && prev.itemId !== next.itemId) return 'playlist_advance';
  return 'video_end';
}

class MediaTransitionAuditService {
  private readonly monitors = new Map<string, ChannelMonitor>();
  private readonly lastVisibleMedia = new Map<string, string>();
  private readonly lastEngineMedia = new Map<string, string>();
  private readonly lastMediaStateLog = new Map<string, number>();
  private readonly pendingMissCheck = new Map<string, ReturnType<typeof setTimeout>>();

  startMonitoring(channelId: string, blueprintId: string): void {
    this.stopMonitoring(channelId);
    const interval = setInterval(() => {
      void this.logCurrentMediaState(channelId, blueprintId);
    }, MEDIA_STATE_INTERVAL_MS);
    this.monitors.set(channelId, { blueprintId, interval });
  }

  stopMonitoring(channelId: string): void {
    const m = this.monitors.get(channelId);
    if (m) clearInterval(m.interval);
    this.monitors.delete(channelId);
    this.lastVisibleMedia.delete(channelId);
    this.lastEngineMedia.delete(channelId);
    this.lastMediaStateLog.delete(channelId);
    const pending = this.pendingMissCheck.get(channelId);
    if (pending) clearTimeout(pending);
    this.pendingMissCheck.delete(channelId);
  }

  /** Log [MEDIA_TRANSITION] when engine or visible media changes. */
  onTimingApplied(params: {
    channelId: string;
    blueprintId?: string;
    inputSource: TransitionInputSource;
    segments: SegmentLike[];
    prevEngineIndex: number;
    newEngineIndex: number;
    prevVisibleIndex: number;
    newVisibleIndex: number;
    ffmpegTimeSec: number;
    visibleTimeSec: number;
    channelSlug?: string;
    reportedVisibleMedia?: string | null;
    reportedEngineIndex?: number;
    reportedVisibleIndex?: number;
  }): void {
    const {
      channelId,
      segments,
      prevEngineIndex,
      newEngineIndex,
      prevVisibleIndex,
      newVisibleIndex,
      ffmpegTimeSec,
      visibleTimeSec,
      inputSource,
      channelSlug,
    } = params;

    const prevEngine = segments[prevEngineIndex];
    const newEngine = segments[newEngineIndex];
    const prevVisible = segments[prevVisibleIndex];
    const newVisible = segments[newVisibleIndex];

    if (newEngine && prevEngineIndex !== newEngineIndex) {
      const cause = inferTransitionCause(prevEngine, newEngine, inputSource);
      logger.info(
        `[MEDIA_TRANSITION] channelId=${channelId} role=engine cause=${cause} inputSource=${inputSource} ` +
          `previousMedia=${prevEngine?.title ?? 'none'} newMedia=${newEngine.title} ` +
          `previousIndex=${prevEngineIndex} newIndex=${newEngineIndex} ` +
          `ffmpegTimeSec=${ffmpegTimeSec.toFixed(2)} visibleTimeSec=${visibleTimeSec.toFixed(2)}`
      );
      this.lastEngineMedia.set(channelId, newEngine.title);
      this.scheduleTransitionMissCheck(channelId, 'engine', newEngine.title, channelSlug, segments);
    }

    if (newVisible && prevVisibleIndex !== newVisibleIndex) {
      const cause = inferTransitionCause(prevVisible, newVisible, inputSource);
      logger.info(
        `[MEDIA_TRANSITION] channelId=${channelId} role=visible cause=${cause} inputSource=${inputSource} ` +
          `previousMedia=${prevVisible?.title ?? 'none'} newMedia=${newVisible.title} ` +
          `previousIndex=${prevVisibleIndex} newIndex=${newVisibleIndex} ` +
          `ffmpegTimeSec=${ffmpegTimeSec.toFixed(2)} visibleTimeSec=${visibleTimeSec.toFixed(2)}`
      );
      this.lastVisibleMedia.set(channelId, newVisible.title);
      this.scheduleTransitionMissCheck(channelId, 'visible', newVisible.title, channelSlug, segments);
    }

    this.maybeLogCurrentMediaStateThrottled(channelId, params.blueprintId);
    this.checkTransitionMissed(channelId, channelSlug, segments, {
      reportedMedia: params.reportedVisibleMedia ?? newVisible?.title ?? newEngine?.title ?? null,
      reportedIndex: params.reportedVisibleIndex ?? newVisibleIndex,
      engineIndex: params.reportedEngineIndex ?? newEngineIndex,
    });
  }

  /** Explicit transition log for window roll / stream start (index forced to 0). */
  onForcedReset(params: {
    channelId: string;
    blueprintId?: string;
    inputSource: TransitionInputSource;
    previousMedia: string | null;
    previousIndex: number | null;
    newMedia: string | null;
    segments: SegmentLike[];
  }): void {
    logger.info(
      `[MEDIA_TRANSITION] channelId=${params.channelId} role=window cause=window_rollover ` +
        `inputSource=${params.inputSource} ` +
        `previousMedia=${params.previousMedia ?? 'none'} newMedia=${params.newMedia ?? 'none'} ` +
        `previousIndex=${params.previousIndex ?? 'n/a'} newIndex=0 ` +
        `ffmpegTimeSec=0.00 visibleTimeSec=0.00`
    );
    if (params.newMedia) this.lastVisibleMedia.set(params.channelId, params.newMedia);
    if (params.newMedia) this.lastEngineMedia.set(params.channelId, params.newMedia);
    if (params.blueprintId) this.startMonitoring(params.channelId, params.blueprintId);
  }

  private scheduleTransitionMissCheck(
    channelId: string,
    role: 'engine' | 'visible',
    reportedMedia: string,
    channelSlug: string | undefined,
    segments: SegmentLike[]
  ): void {
    const existing = this.pendingMissCheck.get(channelId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingMissCheck.delete(channelId);
      void (async () => {
        const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
        const rt = blueprintPlaybackService.getRuntime(channelId);
        const slug = channelSlug ?? rt?.channelSlug;
        const currentReported =
          role === 'visible'
            ? rt?.segments[rt.currentIndex]?.title ?? reportedMedia
            : rt?.segments[rt?.engineSegmentIndex ?? 0]?.title ?? reportedMedia;
        this.checkTransitionMissed(channelId, slug, segments, {
          reportedMedia: currentReported,
          reportedIndex: rt?.currentIndex ?? null,
          engineIndex: rt?.engineSegmentIndex ?? null,
        }, role);
      })();
    }, TRANSITION_MISS_GRACE_MS);
    this.pendingMissCheck.set(channelId, timer);
  }

  /**
   * [TRANSITION_MISSED] — HLS/FFmpeg-derived media differs from reported observer media.
   * VLC reads HLS directly; hls_playlist is the viewer ground truth.
   */
  private checkTransitionMissed(
    channelId: string,
    channelSlug: string | undefined,
    segments: SegmentLike[],
    reported: {
      reportedMedia: string | null;
      reportedIndex: number | null;
      engineIndex: number | null;
    },
    focusRole: 'engine' | 'visible' | 'both' = 'both'
  ): void {
    const { reportedMedia } = reported;
    if (!reportedMedia || segments.length === 0) return;

    const proc = ffmpegService.getProcessInfo(channelId);
    const ffmpegLiveSec =
      typeof proc?.stats.timeSec === 'number' && proc.stats.timeSec >= 0 ? proc.stats.timeSec : null;

    const slug = channelSlug;
    const totalDuration = segments.reduce((s, seg) => s + segmentDurationSec(seg), 0);
    const windowMediaSec =
      ffmpegLiveSec != null
        ? ffmpegLiveSec <= totalDuration + 6
          ? ffmpegLiveSec
          : ((ffmpegLiveSec % totalDuration) + totalDuration) % totalDuration
        : null;

    const ffmpegPos =
      windowMediaSec != null ? findIndexAtElapsed(segments, windowMediaSec) : null;
    const ffmpegMedia = ffmpegPos?.title ?? null;

    let hlsMedia: string | null = null;
    let hlsSource = 'unavailable';
    if (slug) {
      const indexPath = resolveHlsIndexPath(slug, env.STREAMS_DIR);
      const hls = indexPath ? parseHlsVariantPlaylist(indexPath) : null;
      if (hls && hls.liveEdgeSec > 0) {
        const hlsViewerSec = Math.max(0, hls.liveEdgeSec - HLS_VIEWER_LATENCY_SEC);
        let concatSec: number;
        if (!hls.playlistFull) {
          concatSec = hlsViewerSec;
          hlsSource = 'hls_playlist_growing';
        } else {
          concatSec = Math.max(
            0,
            (windowMediaSec ?? hlsViewerSec) - HLS_ENCODE_LEAD_SEC - HLS_VIEWER_LATENCY_SEC
          );
          hlsSource = hls.playlistFull ? 'hls_playlist_full' : 'hls_playlist_growing';
          if (windowMediaSec == null) {
            concatSec = hlsViewerSec;
            hlsSource = 'hls_playlist_only';
          }
        }
        hlsMedia = findIndexAtElapsed(segments, concatSec).title;
      }
    }

    const checks: Array<{ actual: string | null; source: string; role: string }> = [];
    if ((focusRole === 'engine' || focusRole === 'both') && ffmpegMedia && ffmpegMedia !== reportedMedia) {
      checks.push({ actual: ffmpegMedia, source: 'ffmpeg_live', role: 'engine' });
    }
    if ((focusRole === 'visible' || focusRole === 'both') && hlsMedia && hlsMedia !== reportedMedia) {
      checks.push({ actual: hlsMedia, source: hlsSource, role: 'visible' });
    }

    for (const c of checks) {
      logger.warn(
        `[TRANSITION_MISSED] channelId=${channelId} role=${c.role} ` +
          `oldMedia=${this.lastVisibleMedia.get(channelId) ?? 'n/a'} ` +
          `reportedMedia=${reportedMedia} actualMedia=${c.actual} source=${c.source} ` +
          `ffmpegLiveSec=${ffmpegLiveSec?.toFixed(2) ?? 'n/a'} ` +
          `reportedIndex=${reported.reportedIndex ?? 'n/a'} engineIndex=${reported.engineIndex ?? 'n/a'}`
      );
    }
  }

  private async logCurrentMediaState(channelId: string, blueprintId: string): Promise<void> {
    const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
    const rt = blueprintPlaybackService.syncObserversFromFfmpeg(channelId);
    if (!rt?.segments.length) return;

    const proc = ffmpegService.getProcessInfo(channelId);
    const ffmpegLiveSec =
      typeof proc?.stats.timeSec === 'number' && proc.stats.timeSec >= 0 ? proc.stats.timeSec : null;

    const totalDuration = rt.segments.reduce(
      (s, seg) => s + segmentDurationSec(seg as SegmentLike),
      0
    );
    const windowMediaSec =
      ffmpegLiveSec != null
        ? ffmpegLiveSec <= totalDuration + 6
          ? ffmpegLiveSec
          : ((ffmpegLiveSec % totalDuration) + totalDuration) % totalDuration
        : rt.activePlaybackTimeSec;

    const ffmpegPos = findIndexAtElapsed(rt.segments as SegmentLike[], windowMediaSec);
    const visibleSeg = rt.segments[rt.currentIndex];
    const engineSeg = rt.segments[rt.engineSegmentIndex];

    let timelineMedia: string | null = null;
    try {
      const { blueprintService } = await import('./blueprint.service');
      const cursor = await blueprintService.getLiveCursor(blueprintId, channelId, undefined, '24h');
      timelineMedia = cursor.timelineSegment?.title ?? null;
    } catch {
      /* optional */
    }

    const diag = await blueprintPlaybackService.getDiagnostics(channelId);
    const nowPlayingMedia = diag?.currentAsset ?? null;

    logger.info(
      `[CURRENT_MEDIA_STATE] channelId=${channelId} ` +
        `currentMedia=${visibleSeg?.title ?? 'none'} currentIndex=${rt.currentIndex} ` +
        `visibleMedia=${visibleSeg?.title ?? 'none'} visibleIndex=${rt.currentIndex} ` +
        `ffmpegMedia=${ffmpegPos.title ?? engineSeg?.title ?? 'none'} ffmpegIndex=${ffmpegPos.index} ` +
        `engineMedia=${engineSeg?.title ?? 'none'} engineIndex=${rt.engineSegmentIndex} ` +
        `timelineMedia=${timelineMedia ?? 'none'} nowPlayingMedia=${nowPlayingMedia ?? 'none'} ` +
        `activePlaybackTimeSec=${rt.activePlaybackTimeSec.toFixed(2)} ` +
        `ffmpegLiveSec=${ffmpegLiveSec?.toFixed(2) ?? 'n/a'}`
    );
    this.lastMediaStateLog.set(channelId, Date.now());

    this.checkTransitionMissed(channelId, rt.channelSlug, rt.segments as SegmentLike[], {
      reportedMedia: visibleSeg?.title ?? null,
      reportedIndex: rt.currentIndex,
      engineIndex: rt.engineSegmentIndex,
    });
  }

  private maybeLogCurrentMediaStateThrottled(channelId: string, blueprintId?: string): void {
    const now = Date.now();
    const last = this.lastMediaStateLog.get(channelId) ?? 0;
    if (now - last < MEDIA_STATE_INTERVAL_MS) return;
    this.lastMediaStateLog.set(channelId, now);
    if (blueprintId) void this.logCurrentMediaState(channelId, blueprintId);
  }
}

export const mediaTransitionAuditService = new MediaTransitionAuditService();
