/**
 * Duration-map verification — instrumentation ONLY.
 * Validates findIndexAtElapsed() against FFmpeg transition timestamps and live time.
 */
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';

export interface WindowSegmentMapInput {
  title: string;
  itemId?: string | null;
  durationSec: number;
  playbackDurationSec?: number;
  startsAt: string;
  endsAt: string;
}

export interface DurationMapEntry {
  index: number;
  media: string;
  ffprobeDurationSec: number;
  scheduleDurationSec: number;
  /** Observed from FFmpeg transition timestamp; null until first transition away */
  actualDurationSec: number | null;
  concatStartSec: number;
  concatEndSec: number;
  startsAt: string;
  endsAt: string;
}

export interface IndexAtElapsedResult {
  index: number;
  offsetSec: number;
  media: string | null;
}

const TRANSITION_TOLERANCE_SEC = 0.75;
const INDEX_FAILURE_THRESHOLD_MS = 2000;

function playbackDurationSec(seg: WindowSegmentMapInput): number {
  const d = seg.playbackDurationSec ?? seg.durationSec;
  return Number.isFinite(d) && d > 0 ? d : 120;
}

export function buildCumulativeDurationMap(segments: WindowSegmentMapInput[]): DurationMapEntry[] {
  const entries: DurationMapEntry[] = [];
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const ffprobe = playbackDurationSec(seg);
    const scheduleDur = Number.isFinite(seg.durationSec) && seg.durationSec > 0 ? seg.durationSec : ffprobe;
    const start = cursor;
    const end = cursor + ffprobe;
    entries.push({
      index: i,
      media: seg.title,
      ffprobeDurationSec: ffprobe,
      scheduleDurationSec: scheduleDur,
      actualDurationSec: null,
      concatStartSec: start,
      concatEndSec: end,
      startsAt: seg.startsAt,
      endsAt: seg.endsAt,
    });
    cursor = end;
  }
  return entries;
}

/** Same algorithm as blueprintPlayback.findIndexAtElapsed — shared for audit parity */
export function findIndexAtElapsedFromMap(
  map: DurationMapEntry[],
  elapsedSec: number
): IndexAtElapsedResult {
  if (map.length === 0) return { index: 0, offsetSec: 0, media: null };

  const total = map[map.length - 1]?.concatEndSec ?? 0;
  if (total <= 0) return { index: 0, offsetSec: 0, media: map[0]?.media ?? null };

  let remaining = elapsedSec;
  if (remaining >= total) remaining = remaining % total;

  for (const entry of map) {
    const dur = entry.ffprobeDurationSec;
    if (remaining < dur) {
      return { index: entry.index, offsetSec: remaining, media: entry.media };
    }
    remaining -= dur;
  }
  return { index: 0, offsetSec: 0, media: map[0]?.media ?? null };
}

function normalizeWindowMediaSec(rawSec: number, totalSec: number): number {
  if (totalSec <= 0) return Math.max(0, rawSec);
  if (rawSec <= totalSec + 6) return Math.max(0, rawSec);
  return ((rawSec % totalSec) + totalSec) % totalSec;
}

class DurationMapAuditService {
  private readonly maps = new Map<string, DurationMapEntry[]>();
  private readonly lastEngineIndex = new Map<string, number>();
  private readonly indexFailureSince = new Map<string, number>();
  private readonly indexFailureEmitted = new Map<string, string>();

  clearChannel(channelId: string): void {
    this.maps.delete(channelId);
    this.lastEngineIndex.delete(channelId);
    this.indexFailureSince.delete(channelId);
    this.indexFailureEmitted.delete(channelId);
  }

  /** Log [SEGMENT_DURATION_MAP] for every segment in the playback window. */
  logWindowDurationMap(channelId: string, segments: WindowSegmentMapInput[]): void {
    const map = buildCumulativeDurationMap(segments);
    this.maps.set(channelId, map.map((e) => ({ ...e })));
    this.lastEngineIndex.set(channelId, 0);

    logger.info(
      `[SEGMENT_DURATION_MAP] channelId=${channelId} segmentCount=${map.length} ` +
        `totalConcatSec=${map.length ? map[map.length - 1].concatEndSec.toFixed(2) : '0'}`
    );

    for (const e of map) {
      logger.info(
        `[SEGMENT_DURATION_MAP] channelId=${channelId} index=${e.index} media=${e.media} ` +
          `ffprobeDuration=${e.ffprobeDurationSec.toFixed(2)} actualDuration=${e.actualDurationSec?.toFixed(2) ?? 'pending'} ` +
          `startsAt=${e.startsAt} endsAt=${e.endsAt} ` +
          `concatRange=${e.concatStartSec.toFixed(2)}→${e.concatEndSec.toFixed(2)} ` +
          `scheduleDuration=${e.scheduleDurationSec.toFixed(2)}`
      );
    }

    const ranges = map.map((e) => `${e.media} ${e.concatStartSec.toFixed(0)}→${e.concatEndSec.toFixed(0)}`);
    logger.info(`[SEGMENT_DURATION_MAP] channelId=${channelId} cumulativeTable=${ranges.join(' | ')}`);
  }

  getMap(channelId: string): DurationMapEntry[] | undefined {
    return this.maps.get(channelId);
  }

  /**
   * Called on every applyPlaybackTiming — verifies findIndexAtElapsed parity and index resolution.
   */
  onTimingApplied(params: {
    channelId: string;
    blueprintId?: string;
    segments: WindowSegmentMapInput[];
    ffmpegTimeSec: number;
    visibleTimeSec: number;
    ffmpegLiveSec: number | null;
    engineIndex: number;
    visibleIndex: number;
    prevEngineIndex: number;
    prevVisibleIndex: number;
    engineMedia: string | null;
    visibleMedia: string | null;
    currentMedia: string | null;
    inputSource: string;
  }): void {
    let map = this.maps.get(params.channelId);
    if (!map || map.length !== params.segments.length) {
      this.logWindowDurationMap(params.channelId, params.segments);
      map = this.maps.get(params.channelId)!;
    }

    const totalSec = map[map.length - 1]?.concatEndSec ?? 0;
    const liveSec =
      params.ffmpegLiveSec != null ? normalizeWindowMediaSec(params.ffmpegLiveSec, totalSec) : null;

    const ffmpegResolved = findIndexAtElapsedFromMap(map, params.ffmpegTimeSec);
    const visibleResolved = findIndexAtElapsedFromMap(map, params.visibleTimeSec);
    const liveResolved =
      liveSec != null ? findIndexAtElapsedFromMap(map, liveSec) : ffmpegResolved;

    const expectedIndex = liveResolved.index;
    const actualIndex = params.visibleIndex;

    if (params.prevEngineIndex !== params.engineIndex) {
      this.onEngineTransition(params.channelId, map, {
        prevIndex: params.prevEngineIndex,
        newIndex: params.engineIndex,
        ffmpegTimeSec: params.ffmpegTimeSec,
        ffmpegLiveSec: liveSec,
        inputSource: params.inputSource,
      });
      void this.logTransitionVerify(params, map, {
        ffmpegResolved,
        visibleResolved,
        liveResolved,
        expectedIndex,
        actualIndex,
      });
    }

    if (params.prevVisibleIndex !== params.visibleIndex) {
      void this.logTransitionVerify(params, map, {
        ffmpegResolved,
        visibleResolved,
        liveResolved,
        expectedIndex,
        actualIndex,
      });
    }

    this.verifyIndexResolution(params.channelId, map, {
      ffmpegMedia: liveResolved.media ?? ffmpegResolved.media,
      durationMapMedia: ffmpegResolved.media,
      currentMedia: params.currentMedia,
      visibleMedia: params.visibleMedia,
      ffmpegTimeSec: params.ffmpegTimeSec,
      visibleTimeSec: params.visibleTimeSec,
      ffmpegLiveSec: liveSec,
      expectedIndex: liveResolved.index,
      actualIndex: params.visibleIndex,
      engineIndex: params.engineIndex,
      ffmpegResolvedIndex: ffmpegResolved.index,
      visibleResolvedIndex: visibleResolved.index,
    });

    if (ffmpegResolved.index !== params.engineIndex) {
      logger.warn(
        `[INDEX_RESOLUTION_FAILURE] channelId=${params.channelId} kind=engine_index_drift ` +
          `ffmpegMedia=${ffmpegResolved.media} engineMedia=${params.engineMedia} ` +
          `durationMapMedia=${ffmpegResolved.media} ffmpegTimeSec=${params.ffmpegTimeSec.toFixed(2)} ` +
          `expectedBoundary=${map[ffmpegResolved.index]?.concatStartSec.toFixed(2) ?? 'n/a'} ` +
          `resolvedIndex=${ffmpegResolved.index} engineIndex=${params.engineIndex}`
      );
    }

    if (visibleResolved.index !== params.visibleIndex) {
      logger.warn(
        `[INDEX_RESOLUTION_FAILURE] channelId=${params.channelId} kind=visible_index_drift ` +
          `visibleMapMedia=${visibleResolved.media} visibleMedia=${params.visibleMedia} ` +
          `visibleTimeSec=${params.visibleTimeSec.toFixed(2)} ` +
          `resolvedIndex=${visibleResolved.index} visibleIndex=${params.visibleIndex}`
      );
    }
  }

  private onEngineTransition(
    channelId: string,
    map: DurationMapEntry[],
    params: {
      prevIndex: number;
      newIndex: number;
      ffmpegTimeSec: number;
      ffmpegLiveSec: number | null;
      inputSource: string;
    }
  ): void {
    const prev = map[params.prevIndex];
    if (!prev) return;

    const transitionSec = params.ffmpegLiveSec ?? params.ffmpegTimeSec;
    const observedActual = transitionSec - prev.concatStartSec;
    if (observedActual > 0) {
      prev.actualDurationSec = observedActual;
    }

    const expectedEnd = prev.concatEndSec;
    const differenceSec = expectedEnd - transitionSec;

    if (differenceSec > TRANSITION_TOLERANCE_SEC) {
      logger.warn(
        `[DURATION_MAP_MISMATCH] channelId=${channelId} media=${prev.media} ` +
          `expectedEnd=${expectedEnd.toFixed(2)} actualTransition=${transitionSec.toFixed(2)} ` +
          `differenceSec=${differenceSec.toFixed(2)} ` +
          `(FFmpeg entered segment ${params.newIndex} early — ffprobe duration likely too long) ` +
          `ffprobeDuration=${prev.ffprobeDurationSec.toFixed(2)} observedActual=${observedActual.toFixed(2)} ` +
          `inputSource=${params.inputSource}`
      );
    } else if (differenceSec < -TRANSITION_TOLERANCE_SEC) {
      logger.warn(
        `[DURATION_MAP_MISMATCH] channelId=${channelId} media=${prev.media} ` +
          `expectedEnd=${expectedEnd.toFixed(2)} actualTransition=${transitionSec.toFixed(2)} ` +
          `differenceSec=${differenceSec.toFixed(2)} ` +
          `(FFmpeg entered segment ${params.newIndex} late — ffprobe duration likely too short) ` +
          `ffprobeDuration=${prev.ffprobeDurationSec.toFixed(2)} observedActual=${observedActual.toFixed(2)}`
      );
    }

    logger.info(
      `[SEGMENT_DURATION_MAP] channelId=${channelId} index=${prev.index} media=${prev.media} ` +
        `ffprobeDuration=${prev.ffprobeDurationSec.toFixed(2)} actualDuration=${prev.actualDurationSec?.toFixed(2) ?? 'n/a'} ` +
        `startsAt=${prev.startsAt} endsAt=${prev.endsAt} transitionAt=${transitionSec.toFixed(2)}`
    );

    this.lastEngineIndex.set(channelId, params.newIndex);
  }

  private async logTransitionVerify(
    params: {
      channelId: string;
      blueprintId?: string;
      ffmpegTimeSec: number;
      visibleTimeSec: number;
      engineMedia: string | null;
      visibleMedia: string | null;
      currentMedia: string | null;
      engineIndex: number;
      visibleIndex: number;
    },
    map: DurationMapEntry[],
    resolved: {
      ffmpegResolved: IndexAtElapsedResult;
      visibleResolved: IndexAtElapsedResult;
      liveResolved: IndexAtElapsedResult;
      expectedIndex: number;
      actualIndex: number;
    }
  ): Promise<void> {
    let timelineMedia: string | null = null;
    if (params.blueprintId) {
      try {
        const { blueprintService } = await import('./blueprint.service');
        const cursor = await blueprintService.getLiveCursor(
          params.blueprintId,
          params.channelId,
          undefined,
          '24h'
        );
        timelineMedia = cursor.timelineSegment?.title ?? null;
      } catch {
        /* optional */
      }
    }

    const proc = ffmpegService.getProcessInfo(params.channelId);
    const ffmpegLiveSec =
      typeof proc?.stats.timeSec === 'number' ? proc.stats.timeSec : null;

    logger.info(
      `[MEDIA_TRANSITION_VERIFY] channelId=${params.channelId} ` +
        `ffmpegMedia=${resolved.liveResolved.media ?? params.engineMedia ?? 'none'} ` +
        `currentMedia=${params.currentMedia ?? 'none'} ` +
        `visibleMedia=${params.visibleMedia ?? 'none'} ` +
        `timelineMedia=${timelineMedia ?? 'none'} ` +
        `ffmpegTimeSec=${params.ffmpegTimeSec.toFixed(2)} visibleTimeSec=${params.visibleTimeSec.toFixed(2)} ` +
        `ffmpegLiveSec=${ffmpegLiveSec?.toFixed(2) ?? 'n/a'} ` +
        `expectedIndex=${resolved.expectedIndex} actualIndex=${resolved.actualIndex} ` +
        `findIndexAtElapsed(ffmpeg)=${resolved.ffmpegResolved.index}/${resolved.ffmpegResolved.media ?? 'none'} ` +
        `findIndexAtElapsed(visible)=${resolved.visibleResolved.index}/${resolved.visibleResolved.media ?? 'none'} ` +
        `engineIndex=${params.engineIndex} visibleIndex=${params.visibleIndex}`
    );

    const boundary = map[resolved.expectedIndex];
    if (
      resolved.liveResolved.media &&
      params.currentMedia &&
      resolved.liveResolved.media !== params.currentMedia
    ) {
      logger.warn(
        `[MEDIA_TRANSITION_VERIFY] channelId=${params.channelId} MISMATCH ` +
          `durationMapSays=${resolved.liveResolved.media} currentIndexSays=${params.currentMedia} ` +
          `atConcatSec=${params.ffmpegTimeSec.toFixed(2)} boundary=${boundary?.concatStartSec.toFixed(2) ?? 'n/a'}→${boundary?.concatEndSec.toFixed(2) ?? 'n/a'} ` +
          `offendingEntry=index=${boundary?.index ?? resolved.expectedIndex} media=${boundary?.media ?? 'unknown'} ffprobe=${boundary?.ffprobeDurationSec.toFixed(2) ?? 'n/a'}`
      );
    }
  }

  /** [INDEX_RESOLUTION_FAILURE] if ffmpegMedia != currentMedia for >2 seconds. */
  private verifyIndexResolution(
    channelId: string,
    map: DurationMapEntry[],
    state: {
      ffmpegMedia: string | null;
      durationMapMedia: string | null;
      currentMedia: string | null;
      visibleMedia: string | null;
      ffmpegTimeSec: number;
      visibleTimeSec: number;
      ffmpegLiveSec: number | null;
      expectedIndex: number;
      actualIndex: number;
      engineIndex: number;
      ffmpegResolvedIndex: number;
      visibleResolvedIndex: number;
    }
  ): void {
    const mismatchKey = `${state.ffmpegMedia ?? 'none'}|${state.currentMedia ?? 'none'}`;
    const ffmpegSaysB = state.ffmpegMedia && state.currentMedia && state.ffmpegMedia !== state.currentMedia;

    if (!ffmpegSaysB) {
      this.indexFailureSince.delete(channelId);
      this.indexFailureEmitted.delete(channelId);
      return;
    }

    const now = Date.now();
    if (!this.indexFailureSince.has(channelId)) {
      this.indexFailureSince.set(channelId, now);
      return;
    }

    const elapsed = now - (this.indexFailureSince.get(channelId) ?? now);
    if (elapsed < INDEX_FAILURE_THRESHOLD_MS) return;
    if (this.indexFailureEmitted.get(channelId) === mismatchKey) return;

    const entry = map[state.actualIndex] ?? map[state.expectedIndex];
    const expectedBoundary = entry
      ? `${entry.concatStartSec.toFixed(2)}→${entry.concatEndSec.toFixed(2)}`
      : 'n/a';

    logger.error(
      `[INDEX_RESOLUTION_FAILURE] channelId=${channelId} durationSec=${(elapsed / 1000).toFixed(1)} ` +
        `ffmpegMedia=${state.ffmpegMedia} currentMedia=${state.currentMedia} ` +
        `durationMapMedia=${state.durationMapMedia} visibleMedia=${state.visibleMedia} ` +
        `ffmpegTimeSec=${state.ffmpegTimeSec.toFixed(2)} visibleTimeSec=${state.visibleTimeSec.toFixed(2)} ` +
        `ffmpegLiveSec=${state.ffmpegLiveSec?.toFixed(2) ?? 'n/a'} ` +
        `expectedIndex=${state.expectedIndex} actualIndex=${state.actualIndex} ` +
        `findIndexAtElapsed(ffmpeg)=${state.ffmpegResolvedIndex} findIndexAtElapsed(visible)=${state.visibleResolvedIndex} ` +
        `expectedBoundary=${expectedBoundary} ` +
        `offendingEntry=index=${entry?.index ?? 'n/a'} media=${entry?.media ?? 'n/a'} ffprobe=${entry?.ffprobeDurationSec.toFixed(2) ?? 'n/a'}`
    );
    this.indexFailureEmitted.set(channelId, mismatchKey);
  }
}

export const durationMapAuditService = new DurationMapAuditService();
