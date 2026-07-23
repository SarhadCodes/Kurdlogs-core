import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';

export type PlaybackTimeSource = 'ffmpeg_live' | 'runtime_cache' | 'fallback_zero';

/** @deprecated use PlaybackTimeSource */
export type CursorTimeSource = PlaybackTimeSource;

export interface ActivePlaybackTime {
  activePlaybackTimeSec: number;
  source: PlaybackTimeSource;
}

/**
 * Single playback clock — FFmpeg stderr time= only.
 * No HLS, no viewer lag, no schedule math.
 */
export function getActivePlaybackTimeSec(
  channelId: string,
  runtimeCachedSec?: number | null
): ActivePlaybackTime {
  const proc = ffmpegService.getProcessInfo(channelId);
  const live = proc?.stats?.timeSec;
  if (typeof live === 'number' && live >= 0) {
    return { activePlaybackTimeSec: live, source: 'ffmpeg_live' };
  }
  if (typeof runtimeCachedSec === 'number' && runtimeCachedSec >= 0) {
    return { activePlaybackTimeSec: runtimeCachedSec, source: 'runtime_cache' };
  }
  return { activePlaybackTimeSec: 0, source: 'fallback_zero' };
}

/** @deprecated use getActivePlaybackTimeSec */
export function getActiveFfmpegTimecode(
  channelId: string,
  runtimeRawSec?: number | null
): { timeSec: number; source: CursorTimeSource } {
  const r = getActivePlaybackTimeSec(channelId, runtimeRawSec);
  return { timeSec: r.activePlaybackTimeSec, source: r.source };
}

export function logPlaybackTimeSource(
  channelId: string,
  source: PlaybackTimeSource,
  activePlaybackTimeSec: number
): void {
  logger.info(
    `[PLAYBACK_TIME] channelId=${channelId} source=${source} activePlaybackTimeSec=${activePlaybackTimeSec.toFixed(2)}`
  );
}

/** @deprecated */
export const logLiveCursorSource = logPlaybackTimeSource;
