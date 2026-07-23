import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

/** Must match ffmpeg.service.ts HLS_SEGMENT_SECONDS */
export const HLS_SEGMENT_SECONDS = 6;

/** Must match ffmpeg.service.ts HLS_PLAYLIST_MIN_SEGMENTS */
export const HLS_PLAYLIST_MIN_SEGMENTS = 60;

/** Live-edge player buffer — fixed constant, never derived from runtime */
export const HLS_VIEWER_LATENCY_SEC = parseInt(process.env.HLS_VIEWER_LATENCY_SEC || '15', 10);

/** Max encode-ahead when playlist is full (~1 segment) */
export const HLS_ENCODE_LEAD_SEC = HLS_SEGMENT_SECONDS;

export interface HlsPlaylistSegment {
  durationSec: number;
  filename: string;
  programDateTimeMs: number | null;
  /** Cumulative end offset from start of playlist */
  endOffsetSec: number;
}

export interface HlsPlaylistState {
  indexPath: string;
  mediaSequence: number;
  targetDurationSec: number;
  segments: HlsPlaylistSegment[];
  /** Sum of EXTINF — live edge within the sliding window */
  liveEdgeSec: number;
  playlistFull: boolean;
  playlistWindowSec: number;
}

export interface HlsVisiblePlayback {
  /** Fixed viewer buffer — never grows with runtime */
  viewerLatencySec: number;
  totalLagSec: number;
  /** Position within HLS published media timeline */
  hlsVisibleSec: number;
  /** Mapped position within blueprint concat window */
  visibleConcatSec: number;
  /** Index of segment viewers are watching in m3u8 */
  hlsVisibleSegmentIndex: number;
  /** Index of newest segment in m3u8 */
  hlsLatestSegmentIndex: number;
  /** Offset within the visible HLS segment */
  hlsVisibleOffsetSec: number;
  source: 'hls' | 'fallback';
}

export interface ViewerTimingEstimate {
  rawFfmpegTimeSec: number;
  windowMediaSec: number;
  hlsPlaylistWindowSec: number | null;
  playerBufferSec: number;
  totalLagSec: number;
  visibleTimeSec: number;
  hlsVisible: HlsVisiblePlayback | null;
}

/**
 * Parse variant index.m3u8 — segment list, live edge, program date times.
 */
export function parseHlsVariantPlaylist(indexM3u8Path: string): HlsPlaylistState | null {
  try {
    if (!fs.existsSync(indexM3u8Path)) return null;
    const content = fs.readFileSync(indexM3u8Path, 'utf8');
    const lines = content.split(/\r?\n/);

    let mediaSequence = 0;
    let targetDurationSec = HLS_SEGMENT_SECONDS;
    const segments: HlsPlaylistSegment[] = [];
    let cumulative = 0;
    let pendingDuration: number | null = null;
    let pendingPdtMs: number | null = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const seqMatch = line.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/);
      if (seqMatch) {
        mediaSequence = parseInt(seqMatch[1], 10);
        continue;
      }

      const targetMatch = line.match(/^#EXT-X-TARGETDURATION:(\d+)/);
      if (targetMatch) {
        targetDurationSec = parseInt(targetMatch[1], 10);
        continue;
      }

      const pdtMatch = line.match(/^#EXT-X-PROGRAM-DATE-TIME:(.+)/);
      if (pdtMatch) {
        const ms = Date.parse(pdtMatch[1].trim());
        pendingPdtMs = Number.isFinite(ms) ? ms : null;
        continue;
      }

      const extinfMatch = line.match(/^#EXTINF:([\d.]+)/);
      if (extinfMatch) {
        pendingDuration = parseFloat(extinfMatch[1]);
        continue;
      }

      if (line.startsWith('#') || pendingDuration == null) continue;

      cumulative += pendingDuration;
      segments.push({
        durationSec: pendingDuration,
        filename: line,
        programDateTimeMs: pendingPdtMs,
        endOffsetSec: cumulative,
      });
      pendingDuration = null;
      pendingPdtMs = null;
    }

    if (segments.length === 0) return null;

    return {
      indexPath: indexM3u8Path,
      mediaSequence,
      targetDurationSec,
      segments,
      liveEdgeSec: cumulative,
      playlistFull: segments.length >= HLS_PLAYLIST_MIN_SEGMENTS - 2,
      playlistWindowSec: cumulative,
    };
  } catch {
    return null;
  }
}

export function resolveHlsIndexPath(channelSlug: string, streamsDir: string): string | null {
  const candidates = ['720p', '480p'].map((v) =>
    path.join(streamsDir, channelSlug, v, 'index.m3u8')
  );
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findSegmentAtOffset(
  segments: HlsPlaylistSegment[],
  offsetSec: number
): { index: number; offsetSec: number } {
  if (segments.length === 0) return { index: 0, offsetSec: 0 };
  const clamped = Math.max(0, offsetSec);
  for (let i = 0; i < segments.length; i++) {
    const start = i === 0 ? 0 : segments[i - 1].endOffsetSec;
    const end = segments[i].endOffsetSec;
    if (clamped < end) {
      return { index: i, offsetSec: clamped - start };
    }
  }
  const last = segments.length - 1;
  const lastStart = last === 0 ? 0 : segments[last - 1].endOffsetSec;
  return { index: last, offsetSec: clamped - lastStart };
}

/**
 * Derive viewer-visible playback from HLS playlist contents.
 * Lag is ALWAYS the fixed viewer buffer — never cumulative runtime.
 */
export function resolveVisibleFromHlsPlaylist(
  hls: HlsPlaylistState | null,
  windowMediaSec: number,
  viewerLatencySec = HLS_VIEWER_LATENCY_SEC
): HlsVisiblePlayback {
  const totalLagSec = viewerLatencySec;

  if (!hls || hls.liveEdgeSec <= 0) {
    const visibleConcatSec = Math.max(0, windowMediaSec - viewerLatencySec);
    return {
      viewerLatencySec,
      totalLagSec,
      hlsVisibleSec: visibleConcatSec,
      visibleConcatSec,
      hlsVisibleSegmentIndex: 0,
      hlsLatestSegmentIndex: 0,
      hlsVisibleOffsetSec: 0,
      source: 'fallback',
    };
  }

  const hlsVisibleSec = Math.max(0, hls.liveEdgeSec - viewerLatencySec);
  const latestIdx = hls.segments.length - 1;
  const visibleInHls = findSegmentAtOffset(hls.segments, hlsVisibleSec);

  let visibleConcatSec: number;

  if (!hls.playlistFull) {
    // Playlist still filling — published timeline tracks concat 1:1
    visibleConcatSec = hlsVisibleSec;
  } else {
    // Playlist full — encode leads publish by ~1 segment, never by runtime delta
    const encodeLeadSec = HLS_ENCODE_LEAD_SEC;
    visibleConcatSec = Math.max(0, windowMediaSec - encodeLeadSec - viewerLatencySec);
  }

  return {
    viewerLatencySec,
    totalLagSec,
    hlsVisibleSec,
    visibleConcatSec,
    hlsVisibleSegmentIndex: visibleInHls.index,
    hlsLatestSegmentIndex: latestIdx,
    hlsVisibleOffsetSec: visibleInHls.offsetSec,
    source: 'hls',
  };
}

/** Normalize FFmpeg position within current concat window */
export function normalizeWindowMediaSec(rawFfmpegTimeSec: number, windowDurationSec: number): number {
  if (windowDurationSec <= 0) return Math.max(0, rawFfmpegTimeSec);
  if (rawFfmpegTimeSec <= windowDurationSec + HLS_SEGMENT_SECONDS) {
    return Math.max(0, rawFfmpegTimeSec);
  }
  return ((rawFfmpegTimeSec % windowDurationSec) + windowDurationSec) % windowDurationSec;
}

/**
 * Engine position from FFmpeg; visible position from HLS playlist.
 * totalLagSec is always the fixed viewer buffer.
 */
export function resolvePlaybackTiming(
  rawFfmpegTimeSec: number,
  windowDurationSec: number,
  hls: HlsPlaylistState | null,
  viewerLatencySec = HLS_VIEWER_LATENCY_SEC
): ViewerTimingEstimate {
  const windowMediaSec = normalizeWindowMediaSec(rawFfmpegTimeSec, windowDurationSec);
  const hlsVisible = resolveVisibleFromHlsPlaylist(hls, windowMediaSec, viewerLatencySec);

  logger.debug(
    `[LAG_CALC] rawFfmpegTimeSec=${rawFfmpegTimeSec.toFixed(2)} windowMediaSec=${windowMediaSec.toFixed(2)} ` +
      `hlsLiveEdgeSec=${hls?.liveEdgeSec.toFixed(2) ?? 'n/a'} hlsVisibleSec=${hlsVisible.hlsVisibleSec.toFixed(2)} ` +
      `visibleConcatSec=${hlsVisible.visibleConcatSec.toFixed(2)} playerBufferSec=${viewerLatencySec} ` +
      `totalLagSec=${hlsVisible.totalLagSec.toFixed(2)} source=${hlsVisible.source}`
  );

  return {
    rawFfmpegTimeSec,
    windowMediaSec,
    hlsPlaylistWindowSec: hls?.playlistWindowSec ?? null,
    playerBufferSec: viewerLatencySec,
    totalLagSec: hlsVisible.totalLagSec,
    visibleTimeSec: hlsVisible.visibleConcatSec,
    hlsVisible,
  };
}

/** @deprecated Use parseHlsVariantPlaylist — sum EXTINF only */
export function getHlsPlaylistWindowSec(indexM3u8Path: string): number | null {
  const parsed = parseHlsVariantPlaylist(indexM3u8Path);
  return parsed?.playlistWindowSec ?? null;
}

/** Segments written since FFmpeg session start — diagnostic only */
export function getHlsSessionSegmentCount(indexM3u8Path: string, sinceMs: number): number {
  try {
    if (!fs.existsSync(indexM3u8Path) || sinceMs <= 0) return 0;
    const parsed = parseHlsVariantPlaylist(indexM3u8Path);
    if (!parsed) return 0;
    const dir = path.dirname(indexM3u8Path);
    let count = 0;
    for (const seg of parsed.segments) {
      const segPath = path.join(dir, seg.filename);
      try {
        if (fs.existsSync(segPath) && fs.statSync(segPath).mtimeMs >= sinceMs - 1000) {
          count++;
        }
      } catch {
        /* skip */
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/** @deprecated Use getHlsPlaylistWindowSec */
export const getHlsPublishedDurationSec = getHlsPlaylistWindowSec;

/** @deprecated Use resolvePlaybackTiming */
export function estimateViewerMediaTime(
  rawFfmpegTimeSec: number,
  windowDurationSec: number,
  _hlsPlaylistWindowSec: number | null = null,
  playerBufferSec = HLS_VIEWER_LATENCY_SEC
): ViewerTimingEstimate {
  return resolvePlaybackTiming(rawFfmpegTimeSec, windowDurationSec, null, playerBufferSec);
}
