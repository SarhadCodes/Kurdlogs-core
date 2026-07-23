import { env } from './env';

/** Reserved for Flussonic — KurdLogs MCR must never use this port. */
export const FLUSSONIC_RTMP_PORT = 1935;

/** KurdLogs MCR RTMP application name on nginx-rtmp (from env, default live). */
export function getMcrRtmpApp(): string {
  return env.MCR_RTMP_APP;
}

/** @deprecated use getMcrRtmpApp() — kept for imports expecting constant name */
export const MCR_RTMP_APP = env.MCR_RTMP_APP;

/** Build rtmp://nginx-rtmp:{port}/{app}/{streamKey} for all MCR internal traffic. */
export function buildMcrRtmpUrl(streamKey: string): string {
  const url = `rtmp://${env.NGINX_RTMP_HOST}:${env.MCR_RTMP_PORT}/${env.MCR_RTMP_APP}/${streamKey}`;
  assertMcrRtmpUrl(url, 'buildMcrRtmpUrl');
  return url;
}

/** Public OBS/vMix publish URL on the host (uses RTMP_PUBLISH_PORT, typically 1936). */
export function buildMcrPublicIngestUrl(streamKey: string, host?: string): string {
  const h = host ?? env.PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0];
  const url = `rtmp://${h}:${env.RTMP_PUBLISH_PORT}/${env.MCR_RTMP_APP}/${streamKey}`;
  assertMcrRtmpUrl(url, 'buildMcrPublicIngestUrl');
  return url;
}

/** Server URL for OBS (no stream key). */
export function buildMcrPublicIngestServerUrl(host?: string): string {
  const h = host ?? env.PUBLIC_BASE_URL.replace(/^https?:\/\//, '').split(':')[0];
  return `rtmp://${h}:${env.RTMP_PUBLISH_PORT}/${env.MCR_RTMP_APP}`;
}

export function buildMcrInternalIngestUrl(streamKey: string): string {
  return buildMcrRtmpUrl(streamKey);
}

export function getMcrBusStreamKey(channelId: string): string {
  return `mcr-${channelId}`;
}

export function getMcrBusRtmpUrl(channelId: string): string {
  return buildMcrRtmpUrl(getMcrBusStreamKey(channelId));
}

/** Fail fast if an MCR URL targets Flussonic port 1935. */
export function assertMcrRtmpUrl(url: string, context: string): void {
  if (/:1935(\/|:|$)/.test(url)) {
    throw new Error(
      `[MCR_RTMP_POLICY] ${context} must not use port ${FLUSSONIC_RTMP_PORT} (Flussonic): ${url}`
    );
  }
}

export function assertMcrPortConfig(): void {
  if (env.MCR_RTMP_PORT === FLUSSONIC_RTMP_PORT) {
    throw new Error(
      `MCR_RTMP_PORT must not be ${FLUSSONIC_RTMP_PORT} — that port is reserved for Flussonic`
    );
  }
  if (env.RTMP_PUBLISH_PORT === FLUSSONIC_RTMP_PORT) {
    throw new Error(
      `RTMP_PUBLISH_PORT must not be ${FLUSSONIC_RTMP_PORT} — use ${env.MCR_RTMP_PORT} for KurdLogs ingest`
    );
  }
}
