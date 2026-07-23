import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

const VARIANT_INDEX_PATHS = ['720p/index.m3u8', '480p/index.m3u8', '1080p/index.m3u8', 'index.m3u8'];

export function getStreamRoot(slug: string): string {
  return path.join(env.STREAMS_DIR, slug);
}

/** Create master.m3u8 from an existing single-variant index if FFmpeg has not written it yet. */
export function ensureMasterPlaylist(streamRoot: string): string | null {
  const masterPath = path.join(streamRoot, 'master.m3u8');
  if (fs.existsSync(masterPath)) return masterPath;

  const entries: string[] = [];
  for (const variant of ['720p', '480p', '1080p']) {
    const indexPath = path.join(streamRoot, variant, 'index.m3u8');
    if (!fs.existsSync(indexPath)) continue;

    const bandwidth =
      variant === '720p' ? 3200000 : variant === '480p' ? 1500000 : 5000000;
    const resolution =
      variant === '720p' ? '1280x720' : variant === '480p' ? '854x480' : '1920x1080';

    entries.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}`,
      `${variant}/index.m3u8`
    );
  }

  if (entries.length > 0) {
    const body = ['#EXTM3U', '#EXT-X-VERSION:3', ...entries, ''].join('\n');
    fs.mkdirSync(streamRoot, { recursive: true });
    fs.writeFileSync(masterPath, body, 'utf8');
    return masterPath;
  }

  return null;
}

/** Best HLS manifest path relative to the channel folder (for output URLs). */
export function getPublishedHlsManifest(slug: string): string | null {
  const streamRoot = getStreamRoot(slug);
  if (!fs.existsSync(streamRoot)) return null;

  const master = path.join(streamRoot, 'master.m3u8');
  if (fs.existsSync(master)) return 'master.m3u8';

  ensureMasterPlaylist(streamRoot);
  if (fs.existsSync(master)) return 'master.m3u8';

  for (const rel of VARIANT_INDEX_PATHS) {
    if (fs.existsSync(path.join(streamRoot, rel))) return rel;
  }

  return null;
}

export type StreamOutputMode = 'blueprint' | 'live' | 'program' | 'loop' | 'emergency' | 'station';

function streamRootForMode(slug: string, mode: StreamOutputMode = 'blueprint'): string {
  const root = getStreamRoot(slug);
  if (mode === 'live') return path.join(root, '_live');
  if (mode === 'program') return path.join(root, '_program');
  if (mode === 'loop') return path.join(root, '_loop');
  if (mode === 'emergency') return path.join(root, '_emergency');
  if (mode === 'station') return path.join(root, '_station');
  return root;
}

/** Resolve a requested stream file to an on-disk path (with master.m3u8 fallbacks). */
export function resolveStreamFileOnDisk(
  slug: string,
  requestedFile: string,
  mode: StreamOutputMode = 'blueprint'
): string | null {
  const streamRoot = streamRootForMode(slug, mode);
  if (!fs.existsSync(streamRoot)) return null;

  const normalized = requestedFile.replace(/\\/g, '/').replace(/^\/+/, '');
  const direct = path.join(streamRoot, normalized);
  if (fs.existsSync(direct)) return direct;

  if (normalized === 'master.m3u8' || normalized === 'index.m3u8') {
    if (mode !== 'program') {
      const master = ensureMasterPlaylist(streamRoot);
      if (master) return master;
    } else if (normalized === 'master.m3u8') {
      const masterPath = path.join(streamRoot, 'master.m3u8');
      if (fs.existsSync(masterPath)) return masterPath;
    }

    for (const rel of VARIANT_INDEX_PATHS) {
      const candidate = path.join(streamRoot, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/** Newest .ts segment in a variant folder (for post-TAKE fallback when players request stale names). */
export function newestSegmentInVariant(
  slug: string,
  mode: StreamOutputMode = 'blueprint'
): string | null {
  const variantDir = path.join(streamRootForMode(slug, mode), '720p');
  if (!fs.existsSync(variantDir)) return null;

  let newest: { path: string; mtime: number } | null = null;
  for (const name of fs.readdirSync(variantDir)) {
    if (!name.endsWith('.ts')) continue;
    const full = path.join(variantDir, name);
    const mtime = fs.statSync(full).mtimeMs;
    if (!newest || mtime > newest.mtime) {
      newest = { path: full, mtime };
    }
  }
  return newest?.path ?? null;
}

/**
 * Resolve a segment request. During a post-TAKE discontinuity window, if the
 * requested filename does not exist in the active source (VLC still polling
 * blueprint segment names after a switch to live), serve the newest segment
 * from the active source instead of 404 — keeps playback alive.
 */
export function resolveStreamSegmentOnDisk(
  slug: string,
  requestedFile: string,
  mode: StreamOutputMode = 'blueprint',
  allowStaleFallback = false
): string | null {
  const direct = resolveStreamFileOnDisk(slug, requestedFile, mode);
  if (direct) return direct;
  if (!allowStaleFallback || !requestedFile.endsWith('.ts')) return null;
  return newestSegmentInVariant(slug, mode);
}

/** True if a .ts segment was modified recently (stream actively publishing). */
export function hasRecentHlsSegments(
  slug: string,
  maxAgeMs = 30_000,
  mode: StreamOutputMode = 'blueprint'
): boolean {
  const streamRoot = streamRootForMode(slug, mode);
  if (!fs.existsSync(streamRoot)) return false;

  const now = Date.now();
  const scan = (folder: string): boolean => {
    if (!fs.existsSync(folder)) return false;
    for (const name of fs.readdirSync(folder)) {
      if (!name.endsWith('.ts')) continue;
      const mtime = fs.statSync(path.join(folder, name)).mtimeMs;
      if (now - mtime <= maxAgeMs) return true;
    }
    return false;
  };

  if (scan(streamRoot)) return true;
  for (const sub of ['720p', '480p', '1080p']) {
    if (scan(path.join(streamRoot, sub))) return true;
  }
  return false;
}
