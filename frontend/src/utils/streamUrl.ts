import type { PlayerEngine } from '../types/player';
import { getOrCreateViewerSessionId } from './viewerSession';

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
    const base = `/stream/${slug}/t/${encodeURIComponent(streamToken)}/${manifest}`;
    return vsid ? `${base}?vsid=${encodeURIComponent(vsid)}` : base;
  }
  const auth = localStorage.getItem('auth_token');
  if (auth) {
    return `/stream/${slug}/${manifest}?access_token=${encodeURIComponent(auth)}&vsid=${encodeURIComponent(vsid)}`;
  }
  return `/stream/${slug}/${manifest}${vsidSuffix}`;
}

export function buildTokenStreamUrl(
  base: string,
  slug: string,
  token: string,
  manifest = 'master.m3u8'
): string {
  return `${base}/stream/${slug}/t/${encodeURIComponent(token)}/${manifest}`;
}
