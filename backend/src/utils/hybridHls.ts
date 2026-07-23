import path from 'path';
import fs from 'fs';
import type { HybridNormalizationMode } from '@prisma/client';

export const HYBRID_HLS_SEGMENT_SECONDS = 6;
export const HYBRID_HLS_GOP_FRAMES = 144;
export const HYBRID_HLS_LIST_SIZE = 60;

/** Low-latency live relay — keeps VLC/browser within a few seconds of the source. */
export const HYBRID_LIVE_SEGMENT_SECONDS = 1;
export const HYBRID_LIVE_LIST_SIZE = 6;
export const HYBRID_LIVE_GOP_FRAMES = 24;

/** Station ID bumper — short but stable. */
export const HYBRID_STATION_SEGMENT_SECONDS = 2;
export const HYBRID_STATION_LIST_SIZE = 8;
export const HYBRID_STATION_GOP_FRAMES = 48;

export type HybridHlsProfile = 'live' | 'station' | 'default';

function hlsProfileSettings(profile: HybridHlsProfile): {
  segmentSec: number;
  listSize: number;
  gop: number;
  deleteThreshold: number;
  preset: string;
  tune?: string;
} {
  if (profile === 'live') {
    return {
      segmentSec: HYBRID_LIVE_SEGMENT_SECONDS,
      listSize: HYBRID_LIVE_LIST_SIZE,
      gop: HYBRID_LIVE_GOP_FRAMES,
      deleteThreshold: 2,
      preset: 'veryfast',
      tune: 'zerolatency',
    };
  }
  if (profile === 'station') {
    return {
      segmentSec: HYBRID_STATION_SEGMENT_SECONDS,
      listSize: HYBRID_STATION_LIST_SIZE,
      gop: HYBRID_STATION_GOP_FRAMES,
      deleteThreshold: 4,
      preset: 'veryfast',
    };
  }
  return {
    segmentSec: HYBRID_HLS_SEGMENT_SECONDS,
    listSize: HYBRID_HLS_LIST_SIZE,
    gop: HYBRID_HLS_GOP_FRAMES,
    deleteThreshold: 30,
    preset: 'veryfast',
  };
}

export function getHybridVariant(resolution?: string | null): {
  width: number;
  height: number;
  variant: string;
} {
  switch (resolution) {
    case 'RES_480P':
      return { width: 854, height: 480, variant: '480p' };
    case 'RES_1080P':
      return { width: 1920, height: 1080, variant: '1080p' };
    default:
      return { width: 1280, height: 720, variant: '720p' };
  }
}

export function ensureHybridOutputDirs(outDir: string, variant: string): void {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const variantDir = path.join(outDir, variant);
  if (!fs.existsSync(variantDir)) fs.mkdirSync(variantDir, { recursive: true });
}

/** Keep master.m3u8 stable — only write if missing. */
export function ensureHybridMasterPlaylist(outDir: string, variant: string): void {
  const masterPath = path.join(outDir, 'master.m3u8');
  if (fs.existsSync(masterPath)) return;

  const bandwidth =
    variant === '720p' ? 3200000 : variant === '480p' ? 1500000 : 5000000;
  const resolution =
    variant === '720p' ? '1280x720' : variant === '480p' ? '854x480' : '1920x1080';
  const body = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}`,
    `${variant}/index.m3u8`,
    '',
  ].join('\n');
  fs.writeFileSync(masterPath, body, 'utf8');
}

function getNextSegmentNumber(variantDir: string, playlistPath: string): number {
  let max = 0;

  if (fs.existsSync(variantDir)) {
    for (const file of fs.readdirSync(variantDir)) {
      const match = file.match(/^segment_(\d+)\.ts$/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
  }

  if (fs.existsSync(playlistPath)) {
    const content = fs.readFileSync(playlistPath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.trim().match(/segment_(\d+)\.ts/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return max + 1;
}

export function getHybridNextSegmentNumber(outDir: string, variant: string): number {
  const variantDir = path.join(outDir, variant);
  const playlistPath = path.join(variantDir, 'index.m3u8');
  return getNextSegmentNumber(variantDir, playlistPath);
}

/**
 * Prepare for a hybrid handoff — strip ENDLIST and continue monotonic segment numbers.
 * FFmpeg adds DISCONTINUITY via discont_start; do not hand-edit the playlist.
 */
export function prepareHybridHandoff(outDir: string, variant: string): number {
  ensureHybridOutputDirs(outDir, variant);
  const variantDir = path.join(outDir, variant);
  const playlistPath = path.join(variantDir, 'index.m3u8');

  if (fs.existsSync(playlistPath)) {
    let content = fs.readFileSync(playlistPath, 'utf8');
    content = content.replace(/#EXT-X-ENDLIST\s*/g, '').trimEnd();
    if (!content.endsWith('\n')) content += '\n';
    fs.writeFileSync(playlistPath, content, 'utf8');
  }

  return getNextSegmentNumber(variantDir, playlistPath);
}

/**
 * Live handoff — drop the old DVR window so VLC/HLS clients join at the new live edge.
 * Segment numbering stays monotonic; FFmpeg adds DISCONTINUITY via discont_start.
 */
export function prepareHybridLiveHandoff(outDir: string, variant: string): number {
  ensureHybridOutputDirs(outDir, variant);
  const variantDir = path.join(outDir, variant);
  const playlistPath = path.join(variantDir, 'index.m3u8');
  const startNumber = getNextSegmentNumber(variantDir, playlistPath);
  const targetDur = HYBRID_LIVE_SEGMENT_SECONDS + 1;

  fs.writeFileSync(
    playlistPath,
    `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${targetDur}\n`,
    'utf8'
  );

  return startNumber;
}

/**
 * Seamless live handoff — strip ENDLIST, keep recent segments so players never stall,
 * then append live with discont_start. Avoids wiping the playlist to empty.
 */
export function prepareHybridSeamlessLiveHandoff(
  outDir: string,
  variant: string,
  keepSegments = 6
): number {
  ensureHybridOutputDirs(outDir, variant);
  const variantDir = path.join(outDir, variant);
  const playlistPath = path.join(variantDir, 'index.m3u8');
  const startNumber = getNextSegmentNumber(variantDir, playlistPath);

  if (!fs.existsSync(playlistPath)) {
    return startNumber;
  }

  const lines = fs.readFileSync(playlistPath, 'utf8').split('\n');
  const segmentBlocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-ENDLIST')) continue;
    if (line.startsWith('#EXTINF:')) {
      const uri = lines[i + 1]?.trim();
      if (uri && !uri.startsWith('#')) {
        segmentBlocks.push(`${lines[i]}\n${lines[i + 1]}`);
        i++;
      }
    }
  }

  const kept = segmentBlocks.slice(-keepSegments);
  const targetDur = Math.max(
    HYBRID_LIVE_SEGMENT_SECONDS + 1,
    HYBRID_STATION_SEGMENT_SECONDS + 1,
    HYBRID_HLS_SEGMENT_SECONDS + 1
  );

  const rebuilt = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    `#EXT-X-TARGETDURATION:${targetDur}`,
    ...kept,
    '',
  ];
  fs.writeFileSync(playlistPath, rebuilt.join('\n'), 'utf8');

  return startNumber;
}

/** Remove ENDLIST after a one-shot bumper finishes — keeps EVENT-style continuity. */
export function stripHybridEndList(outDir: string, variant: string): void {
  const playlistPath = path.join(outDir, variant, 'index.m3u8');
  if (!fs.existsSync(playlistPath)) return;

  let content = fs.readFileSync(playlistPath, 'utf8');
  if (!content.includes('#EXT-X-ENDLIST')) return;

  content = content.replace(/#EXT-X-ENDLIST\s*/g, '').trimEnd();
  if (!content.endsWith('\n')) content += '\n';
  fs.writeFileSync(playlistPath, content, 'utf8');
}

/** Never serve ENDLIST on live channel playlists — VLC stops playback when it sees it. */
export function sanitizeLiveHlsPlaylist(content: string): string {
  const lines = content.replace(/#EXT-X-ENDLIST\s*/g, '').trimEnd().split('\n');

  if (!lines.some((l) => l.startsWith('#EXT-X-PLAYLIST-TYPE'))) {
    const versionIdx = lines.findIndex((l) => l.startsWith('#EXT-X-VERSION'));
    if (versionIdx >= 0) {
      lines.splice(versionIdx + 1, 0, '#EXT-X-PLAYLIST-TYPE:EVENT');
    }
  }

  if (!lines.some((l) => l.startsWith('#EXT-X-START:'))) {
    const versionIdx = lines.findIndex((l) => l.startsWith('#EXT-X-VERSION'));
    const insertAt = versionIdx >= 0 ? versionIdx + 2 : 2;
    lines.splice(insertAt, 0, '#EXT-X-START:TIME-OFFSET=-3.0');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** Low-latency demuxer options — place immediately before `-i` on live HLS inputs. */
export function appendHybridLiveInputOptions(args: string[]): void {
  args.push(
    '-probesize',
    '500000',
    '-analyzeduration',
    '500000',
    '-fflags',
    '+nobuffer+genpts',
    '-flags',
    'low_delay',
    '-live_start_index',
    '-1'
  );
}

function pushHlsStartNumber(args: string[], startNumber?: number): void {
  if (startNumber != null && startNumber > 0) {
    args.push('-start_number', String(startNumber));
  }
}

function pushHybridEventPlaylistType(args: string[], profile: HybridHlsProfile): void {
  if (profile === 'live' || profile === 'station') {
    args.push('-hls_playlist_type', 'event');
  }
}

function hybridHlsFlags(profile: HybridHlsProfile, continueAppend = false): string {
  const base = 'append_list+independent_segments+program_date_time+delete_segments+temp_file';
  if (profile === 'live' && continueAppend) return base;
  return `${base}+discont_start`;
}

export function appendHybridHlsOutput(
  args: string[],
  outDir: string,
  variant: string,
  videoMap: string,
  hasAudio: boolean,
  startNumber?: number,
  profile: HybridHlsProfile = 'default',
  continueAppend = false
): void {
  const variantDir = path.join(outDir, variant);
  const { segmentSec, listSize, gop, deleteThreshold, preset, tune } = hlsProfileSettings(profile);
  const bitrate =
    variant === '720p'
      ? { b: '2800k', max: '3200k', buf: '8400k' }
      : variant === '480p'
        ? { b: '1200k', max: '1500k', buf: '3600k' }
        : { b: '4500k', max: '5000k', buf: '12000k' };

  args.push('-map', videoMap);
  if (hasAudio) {
    args.push('-map', '0:a?');
  }

  args.push('-c:v', 'libx264', '-preset', preset);
  if (tune) args.push('-tune', tune);
  args.push(
    '-b:v',
    bitrate.b,
    '-maxrate',
    bitrate.max,
    '-bufsize',
    bitrate.buf,
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-sc_threshold',
    '0'
  );

  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
  }

  pushHlsStartNumber(args, startNumber);
  pushHybridEventPlaylistType(args, profile);

  args.push(
    '-max_muxing_queue_size',
    '2048',
    '-f',
    'hls',
    '-hls_time',
    String(segmentSec),
    '-hls_list_size',
    String(listSize),
    '-hls_flags',
    hybridHlsFlags(profile, continueAppend),
    '-hls_delete_threshold',
    String(deleteThreshold),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    hasAudio ? 'v:0,a:0' : 'v:0',
    '-hls_segment_filename',
    path.join(variantDir, 'segment_%05d.ts'),
    path.join(variantDir, 'index.m3u8')
  );
}

export function appendHybridStreamCopyHls(
  args: string[],
  outDir: string,
  variant: string,
  hasAudio: boolean,
  startNumber?: number,
  profile: HybridHlsProfile = 'default',
  continueAppend = false
): void {
  const variantDir = path.join(outDir, variant);
  const { segmentSec, listSize, deleteThreshold } = hlsProfileSettings(profile);
  args.push('-map', '0:v:0');
  if (hasAudio) args.push('-map', '0:a?');
  args.push('-c:v', 'copy');
  if (hasAudio) args.push('-c:a', 'copy');

  pushHlsStartNumber(args, startNumber);
  pushHybridEventPlaylistType(args, profile);

  args.push(
    '-max_muxing_queue_size',
    '4096',
    '-f',
    'hls',
    '-hls_time',
    String(segmentSec),
    '-hls_list_size',
    String(listSize),
    '-hls_flags',
    hybridHlsFlags(profile, continueAppend),
    '-hls_delete_threshold',
    String(deleteThreshold),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    hasAudio ? 'v:0,a:0' : 'v:0',
    '-hls_segment_filename',
    path.join(variantDir, 'segment_%05d.ts'),
    path.join(variantDir, 'index.m3u8')
  );
}

export function buildHybridTranscodeFilter(
  width: number,
  height: number,
  fps: number,
  inputVideo = '[0:v]'
): { filter: string; videoOut: string } {
  return {
    filter:
      `${inputVideo}scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=${fps}[vout]`,
    videoOut: '[vout]',
  };
}

export function normalizationLabel(mode: HybridNormalizationMode): string {
  return mode;
}

export function waitForHlsSegment(
  variantDir: string,
  startNumber: number,
  timeoutMs = 20_000
): Promise<void> {
  const target = `segment_${String(startNumber).padStart(5, '0')}.ts`;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(path.join(variantDir, target))) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for HLS segment ${target}`));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

export interface ParsedHlsSegment {
  extinf: string;
  uri: string;
  number: number;
}

export function parseHlsSegments(content: string): ParsedHlsSegment[] {
  const segments: ParsedHlsSegment[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF:')) continue;
    const uri = lines[i + 1]?.trim();
    if (!uri || uri.startsWith('#')) continue;
    const match = uri.match(/segment_(\d+)\.ts$/);
    segments.push({
      extinf: lines[i],
      uri,
      number: match ? parseInt(match[1], 10) : segments.length,
    });
    i++;
  }

  return segments;
}

/**
 * Hard cut — drop every segment URI from the playlist so players cannot replay stale OBS/blueprint.
 * Segment files stay on disk for numbering continuity; only the manifest is cleared.
 */
export function prepareHybridHardCutHandoff(outDir: string, variant: string): number {
  ensureHybridOutputDirs(outDir, variant);
  const variantDir = path.join(outDir, variant);
  const playlistPath = path.join(variantDir, 'index.m3u8');
  const startNumber = getNextSegmentNumber(variantDir, playlistPath);
  const targetDur = Math.max(
    HYBRID_LIVE_SEGMENT_SECONDS + 1,
    HYBRID_STATION_SEGMENT_SECONDS + 1,
    HYBRID_HLS_SEGMENT_SECONDS + 1
  );

  fs.writeFileSync(
    playlistPath,
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-PLAYLIST-TYPE:EVENT',
      '#EXT-X-START:TIME-OFFSET=-3.0',
      `#EXT-X-TARGETDURATION:${targetDur}`,
      '',
    ].join('\n'),
    'utf8'
  );

  return startNumber;
}

/** Drop blueprint backlog — keep only the last N segments before a transition bumper. */
export function trimPlaylistBeforeTransition(
  outDir: string,
  variant: string,
  keepLast = 0
): number {
  if (keepLast <= 0) {
    return prepareHybridHardCutHandoff(outDir, variant);
  }
  return prepareHybridSeamlessLiveHandoff(outDir, variant, keepLast);
}

export function getHybridPrewarmDir(outDir: string, variant: string): string {
  return path.join(outDir, '.hybrid-prewarm', variant);
}

export function countHlsSegmentsInDir(variantDir: string): number {
  if (!fs.existsSync(variantDir)) return 0;
  return fs.readdirSync(variantDir).filter((f) => /^segment_\d+\.ts$/.test(f)).length;
}

/** Wait until the prewarm buffer has enough live segments to splice in instantly. */
export function waitForPrewarmSegments(
  prewarmDir: string,
  minSegments = 3,
  timeoutMs = 30_000
): Promise<void> {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const playlistPath = path.join(prewarmDir, 'index.m3u8');
      const count = fs.existsSync(playlistPath)
        ? parseHlsSegments(fs.readFileSync(playlistPath, 'utf8')).length
        : countHlsSegmentsInDir(prewarmDir);

      if (count >= minSegments) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${minSegments} prewarm segments (got ${count})`));
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

/**
 * Splice pre-buffered live segments into the main playlist the moment station ID ends.
 * Keeps only recent station segments (not old blueprint) so players jump straight to live.
 */
export function mergePrewarmIntoMain(
  outDir: string,
  variant: string,
  options?: { stationStartNumber?: number; keepStationSegments?: number }
): { nextStartNumber: number; mergedLiveCount: number } {
  const keepStationSegments = options?.keepStationSegments ?? 0;
  const variantDir = path.join(outDir, variant);
  const prewarmDir = getHybridPrewarmDir(outDir, variant);
  const mainPlaylistPath = path.join(variantDir, 'index.m3u8');
  const prewarmPlaylistPath = path.join(prewarmDir, 'index.m3u8');

  ensureHybridOutputDirs(outDir, variant);

  let stationSegments: ParsedHlsSegment[] = [];
  if (fs.existsSync(mainPlaylistPath)) {
    stationSegments = parseHlsSegments(fs.readFileSync(mainPlaylistPath, 'utf8'));
    if (options?.stationStartNumber != null) {
      stationSegments = stationSegments.filter((s) => s.number >= options.stationStartNumber!);
    }
    stationSegments = stationSegments.slice(-keepStationSegments);
  }

  const prewarmSegments = fs.existsSync(prewarmPlaylistPath)
    ? parseHlsSegments(fs.readFileSync(prewarmPlaylistPath, 'utf8'))
    : [];

  let nextNumber = getNextSegmentNumber(variantDir, mainPlaylistPath);
  const mergedLive: ParsedHlsSegment[] = [];

  for (const seg of prewarmSegments) {
    const srcPath = path.join(prewarmDir, path.basename(seg.uri));
    if (!fs.existsSync(srcPath)) continue;

    const destName = `segment_${String(nextNumber).padStart(5, '0')}.ts`;
    fs.copyFileSync(srcPath, path.join(variantDir, destName));
    mergedLive.push({ extinf: seg.extinf, uri: destName, number: nextNumber });
    nextNumber++;
  }

  const targetDur = Math.max(
    HYBRID_LIVE_SEGMENT_SECONDS + 1,
    HYBRID_STATION_SEGMENT_SECONDS + 1,
    HYBRID_HLS_SEGMENT_SECONDS + 1
  );

  const rebuilt: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    '#EXT-X-START:TIME-OFFSET=-3.0',
    `#EXT-X-TARGETDURATION:${targetDur}`,
  ];

  for (const seg of stationSegments) {
    rebuilt.push(seg.extinf, seg.uri);
  }
  if (mergedLive.length > 0) {
    rebuilt.push('#EXT-X-DISCONTINUITY');
    for (const seg of mergedLive) {
      rebuilt.push(seg.extinf, seg.uri);
    }
  }
  rebuilt.push('');
  fs.writeFileSync(mainPlaylistPath, rebuilt.join('\n'), 'utf8');

  const prewarmRoot = path.join(outDir, '.hybrid-prewarm');
  if (fs.existsSync(prewarmRoot)) {
    fs.rmSync(prewarmRoot, { recursive: true, force: true });
  }

  return { nextStartNumber: nextNumber, mergedLiveCount: mergedLive.length };
}

export function cleanupHybridPrewarm(outDir: string): void {
  const prewarmRoot = path.join(outDir, '.hybrid-prewarm');
  if (fs.existsSync(prewarmRoot)) {
    fs.rmSync(prewarmRoot, { recursive: true, force: true });
  }
}
