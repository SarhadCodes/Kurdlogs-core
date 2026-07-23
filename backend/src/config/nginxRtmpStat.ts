import { env } from './env';
import { logger } from '../utils/logger';

export interface NginxRtmpStreamStat {
  application: string;
  streamName: string;
  bwIn: number;
  bwVideo: number;
  fps: number;
  publishing: boolean;
  publisherCount: number;
  clientCount: number;
}

/** RTMP application name from env (must match nginx rtmp { application NAME { ... } }). */
export function getConfiguredRtmpApp(): string {
  return env.MCR_RTMP_APP;
}

/** Parse rtmp.server.application[].name values from nginx-rtmp stat XML. */
export function parseNginxApplicationNames(xml: string): string[] {
  const apps: string[] = [];
  const appRe = /<application>[\s\S]*?<\/application>/g;
  let appMatch: RegExpExecArray | null;
  while ((appMatch = appRe.exec(xml)) !== null) {
    const nameMatch = appMatch[0].match(/<name>([^<]+)<\/name>/);
    if (nameMatch) apps.push(nameMatch[1].trim());
  }
  return [...new Set(apps)];
}

/**
 * Prefer configured app when present in stat; otherwise use first discovered application.
 */
export function resolveNginxRtmpApp(configuredApp: string, discoveredApps: string[]): string {
  if (discoveredApps.includes(configuredApp)) return configuredApp;
  if (discoveredApps.length > 0) {
    logger.warn(
      `[MCR_NGINX_APPLICATIONS] configured=${configuredApp} not in stat — ` +
        `falling back to discovered=${discoveredApps[0]}`
    );
    return discoveredApps[0];
  }
  return configuredApp;
}

export function logNginxApplications(
  discoveredApps: string[],
  configuredApp: string,
  resolvedApp: string
): void {
  logger.info(
    `[MCR_NGINX_APPLICATIONS] applications=${discoveredApps.join(',') || 'none'} ` +
      `configured=${configuredApp} resolved=${resolvedApp}`
  );
}

export function logNginxStatRaw(xml: string): void {
  const compact = xml.replace(/\s+/g, ' ').trim();
  const preview = compact.length > 1200 ? `${compact.slice(0, 1200)}…` : compact;
  logger.info(`[MCR_NGINX_STAT_RAW] ${preview}`);
}

function parseStreamBlock(block: string): Omit<NginxRtmpStreamStat, 'application'> | null {
  const nameMatch = block.match(/<name>([^<]+)<\/name>/);
  if (!nameMatch) return null;
  const streamName = nameMatch[1].trim();
  if (!streamName) return null;

  const bwIn = parseInt(block.match(/<bw_in>(\d+)<\/bw_in>/)?.[1] ?? '0', 10);
  const bwVideo = parseInt(block.match(/<bw_video>(\d+)<\/bw_video>/)?.[1] ?? '0', 10);
  const fps = parseFloat(block.match(/<fps>([\d.]+)<\/fps>/)?.[1] ?? '0');
  const publishing = block.includes('<publishing/>') || block.includes('<publishing />');
  const nclients = parseInt(block.match(/<nclients>(\d+)<\/nclients>/)?.[1] ?? '0', 10);

  return {
    streamName,
    bwIn,
    bwVideo,
    fps,
    publishing,
    publisherCount: publishing ? Math.max(1, nclients) : 0,
    clientCount: nclients,
  };
}

/** Parse all streams grouped by parent application name. */
export function parseNginxStreams(xml: string): NginxRtmpStreamStat[] {
  const streams: NginxRtmpStreamStat[] = [];
  const appRe = /<application>[\s\S]*?<\/application>/g;
  let appMatch: RegExpExecArray | null;

  while ((appMatch = appRe.exec(xml)) !== null) {
    const appBlock = appMatch[0];
    const appNameMatch = appBlock.match(/<name>([^<]+)<\/name>/);
    const application = appNameMatch?.[1]?.trim() ?? 'unknown';

    const streamRe = /<stream>[\s\S]*?<\/stream>/g;
    let streamMatch: RegExpExecArray | null;
    while ((streamMatch = streamRe.exec(appBlock)) !== null) {
      const parsed = parseStreamBlock(streamMatch[0]);
      if (!parsed) continue;
      streams.push({ application, ...parsed });
    }
  }
  return streams;
}

export function streamsForApplication(
  streams: NginxRtmpStreamStat[],
  application: string
): NginxRtmpStreamStat[] {
  return streams.filter((s) => s.application === application);
}
