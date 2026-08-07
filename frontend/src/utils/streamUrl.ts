import type { PlayerEngine } from '../types/player';
import { getOrCreateViewerSessionId } from './viewerSession';
import { getAdminStreamBaseUrl, getPublicStreamBaseUrl } from '../config/runtime';

/** Manifest file used in the preview player for each engine mode. */
export function getPreviewManifestForEngine(engine: PlayerEngine): string {
  if (engine === 'dashjs') return 'manifest.mpd';
  return 'master.m3u8';
}

/** Playlist channels publish one HLS variant (default 720p). */
export function getPlaylistVariantManifest(resolution?: string | null): string {
  if (resolution === 'RES_480P') return '480p/index.m3u8';
  if (resolution === 'RES_1080P') return '1080p/index.m3u8';
  return '720p/index.m3u8';
}

/** Build HLS/DASH URL — stream token is embedded in the path, not ?token= after the file. */
export function buildStreamUrl(
  slug: string,
  manifest = 'master.m3u8',
  streamToken?: string
): string {
  const vsid = getOrCreateViewerSessionId();
  const vsidSuffix = vsid ? `?vsid=${encodeURIComponent(vsid)}` : '';

  if (streamToken) {
    const base = `${getPublicStreamBaseUrl()}/${slug}/t/${encodeURIComponent(streamToken)}/${manifest}`;
    return vsid ? `${base}?vsid=${encodeURIComponent(vsid)}` : base;
  }
  // Admin preview uses the API host's httpOnly cookie — never put JWT in the URL.
  return `${getAdminStreamBaseUrl()}/${slug}/${manifest}${vsidSuffix}`;
}

export function buildTokenStreamUrl(
  streamBase: string,
  slug: string,
  token: string,
  manifest = 'master.m3u8'
): string {
  return `${streamBase}/${slug}/t/${encodeURIComponent(token)}/${manifest}`;
}
