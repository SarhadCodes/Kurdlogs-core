import { prisma } from '../config/database';
import { env } from '../config/env';
import {
  getConfiguredRtmpApp,
  logNginxApplications,
  logNginxStatRaw,
  parseNginxApplicationNames,
  parseNginxStreams as parseNginxStreamsFromXml,
  resolveNginxRtmpApp,
  streamsForApplication,
} from '../config/nginxRtmpStat';
import { logger } from '../utils/logger';
import { waitForRtmpPlayable } from '../utils/mcrRtmpProbe';
import { mcrRelayService } from './mcrRelay.service';
import { mcrBusHolderService } from './mcrBusHolder.service';

export type McrBusAuditFailureCode =
  | 'BUS_NOT_PUBLISHING'
  | 'BUS_URL_MISMATCH'
  | 'BUS_STREAM_NOT_FOUND'
  | 'NGINX_APP_NOT_FOUND'
  | 'ENCODER_INPUT_UNREACHABLE';

export class McrBusAuditError extends Error {
  constructor(
    public readonly code: McrBusAuditFailureCode,
    message: string,
    public readonly report: McrBusAuditReport
  ) {
    super(`[${code}] ${message}`);
    this.name = 'McrBusAuditError';
  }
}

export interface ParsedRtmpUrl {
  host: string;
  port: string;
  app: string;
  streamKey: string;
  raw: string;
}

export interface NginxStreamStat {
  application: string;
  streamName: string;
  bwIn: number;
  bwVideo: number;
  fps: number;
  publishing: boolean;
  publisherCount: number;
  clientCount: number;
}

export interface McrBusAuditReport {
  channelId: string;
  slug: string;
  busPublishUrl: string;
  encoderInputUrl: string;
  busStreamKey: string;
  publisherVisible: boolean;
  nginxStreamName: string | null;
  nginxApplication: string | null;
  currentBitrate: number;
  currentFps: number;
  busPublisherFfmpegPid: number | null;
  busPublisherMode: 'relay' | 'slate' | 'none';
  encoderInputReachable: boolean;
  urlMatch: boolean;
  hostnameMatch: boolean;
  applicationMatch: boolean;
  streamKeyMatch: boolean;
  match: boolean;
  failureCode: McrBusAuditFailureCode | null;
  failureDetail: string | null;
}

class McrBusDebugAuditService {
  parseRtmpUrl(url: string): ParsedRtmpUrl | null {
    const trimmed = url.trim();
    const m = trimmed.match(/^rtmp:\/\/([^/:]+)(?::(\d+))?\/([^/]+)\/([^/?#]+)/i);
    if (!m) return null;
    return {
      host: m[1].toLowerCase(),
      port: m[2] ?? '1935',
      app: m[3],
      streamKey: m[4],
      raw: trimmed,
    };
  }

  private async fetchNginxStatXml(): Promise<string | null> {
    try {
      const res = await fetch(`http://${env.NGINX_RTMP_HOST}:8080/stat`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  private resolveBusPublisher(channelId: string): {
    publishUrl: string;
    streamKey: string;
    ffmpegPid: number | null;
    mode: 'relay' | 'slate' | 'none';
  } {
    const publishUrl = mcrRelayService.getBusRtmpUrl(channelId);
    const streamKey = mcrRelayService.getBusStreamKey(channelId);
    const relay = mcrRelayService.getRelayInfo(channelId);
    if (relay && mcrRelayService.isRunning(channelId)) {
      return { publishUrl, streamKey, ffmpegPid: relay.pid, mode: 'relay' };
    }
    const slatePid = mcrBusHolderService.getHolderPid(channelId);
    if (slatePid) {
      return { publishUrl, streamKey, ffmpegPid: slatePid, mode: 'slate' };
    }
    return { publishUrl, streamKey, ffmpegPid: null, mode: 'none' };
  }

  private logNginxStatEntries(streams: NginxStreamStat[], busStreamKey: string): NginxStreamStat | null {
    let busStream: NginxStreamStat | null = null;
    for (const s of streams) {
      logger.info(
        `[NGINX] app=${s.application} streamKey=${s.streamName} bitrate=${s.bwIn} ` +
          `bwVideo=${s.bwVideo} fps=${s.fps} publishing=${s.publishing} ` +
          `clients=${s.clientCount} detected=${s.streamName === busStreamKey ? 'bus-match' : 'other'}`
      );
      if (s.streamName === busStreamKey) busStream = s;
    }
    return busStream;
  }

  /**
   * Full OBS → session → bus → nginx → encoder path audit.
   * Does not change playback — only logs diagnostics and throws on mismatch.
   */
  async runPathAudit(channelId: string, encoderInputUrl?: string): Promise<McrBusAuditReport> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true, sourceUrl: true },
    });
    if (!channel) {
      throw new Error(`MCR bus audit: channel ${channelId} not found`);
    }

    const publisher = this.resolveBusPublisher(channelId);
    const busPublishUrl = publisher.publishUrl;
    const inputUrl = encoderInputUrl?.trim() || channel.sourceUrl?.trim() || busPublishUrl;

    logger.info(
      `[MCR_BUS_PUBLISH] channelId=${channelId} publishUrl=${busPublishUrl} ` +
        `streamKey=${publisher.streamKey} ffmpegPid=${publisher.ffmpegPid ?? 'none'} mode=${publisher.mode}`
    );

    logger.info(
      `[MCR_RELAY] channelId=${channelId} publishUrl=${busPublishUrl} streamKey=${publisher.streamKey} ` +
        `ffmpegPid=${publisher.ffmpegPid ?? 'none'} mode=${publisher.mode} connected=${publisher.mode !== 'none'}`
    );

    const xml = await this.fetchNginxStatXml();
    if (xml) logNginxStatRaw(xml);

    const configuredApp = getConfiguredRtmpApp();
    const discoveredApps = xml ? parseNginxApplicationNames(xml) : [];
    const resolvedApp = resolveNginxRtmpApp(configuredApp, discoveredApps);
    logNginxApplications(discoveredApps, configuredApp, resolvedApp);

    const allStreams = xml ? parseNginxStreamsFromXml(xml) : [];
    const appStreams = streamsForApplication(allStreams, resolvedApp);
    const busStreamStat = xml
      ? this.logNginxStatEntries(allStreams, publisher.streamKey)
      : null;

    const nginxBitrate = busStreamStat?.bwIn ?? 0;
    const nginxFps = busStreamStat?.fps ?? 0;
    const publisherSlotVisible = !!(
      busStreamStat && (busStreamStat.publishing || busStreamStat.clientCount > 0)
    );
    const publisherVisible =
      nginxBitrate > 0 || (busStreamStat?.bwVideo ?? 0) > 0;

    if (publisherSlotVisible && !publisherVisible) {
      logger.warn(
        `[MCR_BUS_NOT_PUBLISHING] streamKey=${publisher.streamKey} publisherVisible=true bitrate=0`
      );
    }

    logger.info(
      `[MCR_BUS_VERIFY] channelId=${channelId} streamKey=${publisher.streamKey} ` +
        `publisherVisible=${publisherVisible} bitrate=${nginxBitrate} fps=${nginxFps} ` +
        `publishing=${busStreamStat?.publishing ?? false} relayRunning=${mcrRelayService.isRunning(channelId)} ` +
        `slateHolding=${mcrBusHolderService.isHolding(channelId)}`
    );

    const encoderReachable = publisherVisible
      ? await waitForRtmpPlayable(inputUrl, 20_000, { context: 'encoder-audit' })
      : false;
    logger.info(
      `[ENCODER] channelId=${channelId} inputUrl=${inputUrl} ffprobeResult=${encoderReachable} ` +
        `startupGate=${encoderReachable ? 'pass' : 'blocked'}`
    );

    const busParsed = this.parseRtmpUrl(busPublishUrl);
    const encParsed = this.parseRtmpUrl(inputUrl);

    const hostnameMatch =
      !!busParsed && !!encParsed && busParsed.host === encParsed.host;
    const applicationMatch =
      !!busParsed && !!encParsed && busParsed.app === encParsed.app;
    const streamKeyMatch =
      !!busParsed && !!encParsed && busParsed.streamKey === encParsed.streamKey;
    const urlMatch =
      busPublishUrl === inputUrl ||
      (hostnameMatch &&
        applicationMatch &&
        streamKeyMatch &&
        busParsed!.port === encParsed!.port);

    let failureCode: McrBusAuditFailureCode | null = null;
    let failureDetail: string | null = null;

    if (!xml) {
      failureCode = 'NGINX_APP_NOT_FOUND';
      failureDetail = `nginx-rtmp stat unreachable (host=${env.NGINX_RTMP_HOST}:8080/stat)`;
    } else if (discoveredApps.length === 0) {
      failureCode = 'NGINX_APP_NOT_FOUND';
      failureDetail = `nginx-rtmp stat contains no rtmp applications (host=${env.NGINX_RTMP_HOST}:8080/stat)`;
    } else if (!discoveredApps.includes(configuredApp) && resolvedApp !== configuredApp) {
      logger.warn(
        `[MCR_NGINX_APPLICATIONS] using discovered app=${resolvedApp} instead of configured=${configuredApp}`
      );
    }

    if (!failureCode && !busStreamStat) {
      failureCode = 'BUS_STREAM_NOT_FOUND';
      failureDetail =
        `stream "${publisher.streamKey}" not registered on nginx app="${resolvedApp}" — ` +
        `available=[${appStreams.map((s) => s.streamName).join(', ') || 'none'}]`;
    } else if (!failureCode && !urlMatch) {
      failureCode = 'BUS_URL_MISMATCH';
      failureDetail =
        `busPublish host=${busParsed?.host ?? '?'} app=${busParsed?.app ?? '?'} key=${busParsed?.streamKey ?? '?'} ` +
        `encoderInput host=${encParsed?.host ?? '?'} app=${encParsed?.app ?? '?'} key=${encParsed?.streamKey ?? '?'} ` +
        `(expected host=${env.NGINX_RTMP_HOST} app=${resolvedApp} key=${publisher.streamKey})`;
    } else if (!failureCode && (!publisherVisible || !encoderReachable)) {
      if (!publisherVisible) {
        failureCode = 'BUS_NOT_PUBLISHING';
        failureDetail =
          `bus stream "${publisher.streamKey}" on nginx but not publishing media ` +
          `(bwIn=${nginxBitrate} publishing=${busStreamStat?.publishing} clients=${busStreamStat?.clientCount} ` +
          `relayPid=${publisher.ffmpegPid ?? 'none'} mode=${publisher.mode})`;
      } else {
        failureCode = 'ENCODER_INPUT_UNREACHABLE';
        failureDetail =
          `ffprobe cannot read program encoder input ${inputUrl} ` +
          `(nginx bitrate=${nginxBitrate})`;
      }
    }

    const match = failureCode === null;

    const report: McrBusAuditReport = {
      channelId,
      slug: channel.slug,
      busPublishUrl,
      encoderInputUrl: inputUrl,
      busStreamKey: publisher.streamKey,
      publisherVisible,
      nginxStreamName: busStreamStat?.streamName ?? null,
      nginxApplication: busStreamStat?.application ?? resolvedApp,
      currentBitrate: nginxBitrate,
      currentFps: nginxFps,
      busPublisherFfmpegPid: publisher.ffmpegPid,
      busPublisherMode: publisher.mode,
      encoderInputReachable: encoderReachable,
      urlMatch,
      hostnameMatch,
      applicationMatch,
      streamKeyMatch,
      match,
      failureCode,
      failureDetail,
    };

    logger.info(
      `[MCR_BUS_AUDIT_REPORT] channelId=${channelId} slug=${channel.slug} ` +
        `BusPublishURL=${busPublishUrl} EncoderInputURL=${inputUrl} ` +
        `PublisherVisible=${publisherVisible} nginxStreamName=${report.nginxStreamName ?? 'none'} ` +
        `CurrentBitrate=${nginxBitrate} CurrentFPS=${nginxFps} Match=${match}` +
        (failureCode ? ` Failure=${failureCode} Detail=${failureDetail}` : '')
    );

    if (failureCode) {
      throw new McrBusAuditError(failureCode, failureDetail ?? failureCode, report);
    }

    return report;
  }

  /** Log publish diagnostics when a bus publisher FFmpeg process starts. */
  logBusPublishStart(
    channelId: string,
    publishUrl: string,
    ffmpegPid: number | null,
    mode: 'relay' | 'slate'
  ): void {
    const streamKey = mcrRelayService.getBusStreamKey(channelId);
    logger.info(
      `[MCR_BUS_PUBLISH] channelId=${channelId} publishUrl=${publishUrl} ` +
        `streamKey=${streamKey} ffmpegPid=${ffmpegPid ?? 'none'} mode=${mode}`
    );
  }
}

export const mcrBusDebugAuditService = new McrBusDebugAuditService();
