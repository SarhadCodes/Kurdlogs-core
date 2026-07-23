import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { buildMcrInternalIngestUrl } from '../config/mcrRtmp';
import { getConfiguredRtmpApp } from '../config/nginxRtmpStat';
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import { mcrRelayService } from './mcrRelay.service';
import { mcrBusHolderService } from './mcrBusHolder.service';
import { mcrIngestService } from './mcrIngest.service';
import { wsService } from './websocket.service';

interface ParsedRtmpUrl {
  host: string;
  port: string;
  app: string;
  streamKey: string;
}

export interface McrBindingSnapshot {
  channelId: string;
  slug: string;
  programBus: string;
  programEncoder: string;
  viewerOutput: string;
  connected: boolean;
  busActive: boolean;
  encoderConnected: boolean;
  encoderOnline: boolean;
  relaySourceId: string | null;
}

class McrBindingService {
  private isEncoderAlive(channelId: string): boolean {
    const proc = ffmpegService.getProcessInfo(channelId);
    if (!proc?.pid) return false;
    try {
      process.kill(proc.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private parseRtmpUrl(url: string): ParsedRtmpUrl | null {
    const m = url.trim().match(/^rtmp:\/\/([^/:]+)(?::(\d+))?\/([^/]+)\/([^/?#]+)/i);
    if (!m) return null;
    return {
      host: m[1].toLowerCase(),
      port: m[2] ?? '1935',
      app: m[3],
      streamKey: m[4],
    };
  }

  /** Same HLS segment math as monitor.service — used only for bitrate diagnostics. */
  private measureHlsSegmentBitrateKbps(slug: string): number {
    try {
      const dir = path.join(env.STREAMS_DIR, slug);
      if (!fs.existsSync(dir)) return 0;

      const segmentFiles: { size: number; mtime: number }[] = [];
      const collectTs = (folder: string) => {
        if (!fs.existsSync(folder)) return;
        for (const name of fs.readdirSync(folder)) {
          if (!name.endsWith('.ts')) continue;
          const stat = fs.statSync(path.join(folder, name));
          segmentFiles.push({ size: stat.size, mtime: stat.mtimeMs });
        }
      };

      collectTs(dir);
      for (const sub of ['1080p', '720p', '480p']) {
        collectTs(path.join(dir, sub));
      }

      segmentFiles.sort((a, b) => b.mtime - a.mtime);
      if (segmentFiles.length < 2) return 0;

      const latest = segmentFiles[0];
      const prev = segmentFiles[1];
      const segDurationSec = (latest.mtime - prev.mtime) / 1000;
      if (segDurationSec <= 0 || segDurationSec > 30) return 0;

      return Math.round((latest.size * 8) / segDurationSec / 1000);
    } catch {
      return 0;
    }
  }

  /**
   * Compare relay publish URL vs nginx stat/ffprobe lookup vs program encoder input.
   * Does not change routing — diagnostics only.
   */
  private async logBindingCompare(
    channelId: string,
    channel: { slug: string; sourceUrl: string | null },
    snapshot: McrBindingSnapshot,
    relayRunning: boolean,
    onNginx: boolean
  ): Promise<void> {
    const busKey = mcrRelayService.getBusStreamKey(channelId);
    const relayPublishUrl = mcrRelayService.getBusRtmpUrl(channelId);
    const nginxFfprobeUrl = buildMcrInternalIngestUrl(busKey);
    const configuredApp = getConfiguredRtmpApp();
    const nginxStatUrl =
      `http://${env.NGINX_RTMP_HOST}:8080/stat?app=${configuredApp}&key=${busKey}`;

    const encoderInputUrl = channel.sourceUrl?.trim() || relayPublishUrl;
    const relayParsed = this.parseRtmpUrl(relayPublishUrl);
    const nginxParsed = this.parseRtmpUrl(nginxFfprobeUrl);
    const encoderParsed = this.parseRtmpUrl(encoderInputUrl);

    const hostMatch =
      !!relayParsed &&
      !!encoderParsed &&
      relayParsed.host === encoderParsed.host &&
      relayParsed.host === (nginxParsed?.host ?? '');
    const portMatch =
      !!relayParsed &&
      !!encoderParsed &&
      relayParsed.port === encoderParsed.port &&
      relayParsed.port === (nginxParsed?.port ?? '');
    const appMatch =
      !!relayParsed &&
      !!encoderParsed &&
      relayParsed.app === encoderParsed.app &&
      relayParsed.app === (nginxParsed?.app ?? '');
    const keyMatch =
      !!relayParsed &&
      !!encoderParsed &&
      relayParsed.streamKey === encoderParsed.streamKey &&
      relayParsed.streamKey === (nginxParsed?.streamKey ?? '');

    const relayInfo = mcrRelayService.getRelayInfo(channelId);
    const nginxStat = await mcrIngestService.getNginxStreamStat(busKey);
    const proc = ffmpegService.getProcessInfo(channelId);
    const relaySendingBytes = !!(nginxStat && (nginxStat.bwIn > 0 || nginxStat.bwVideo > 0));
    const encoderAlive = this.isEncoderAlive(channelId);
    const dbSourceHasBusKey = String(channel.sourceUrl ?? '').includes(`mcr-${channelId}`);
    const segBitrate = this.measureHlsSegmentBitrateKbps(channel.slug);
    const statsAny = proc?.stats as Record<string, unknown> | undefined;

    logger.info(
      `[MCR_BINDING_COMPARE] channelId=${channelId} ` +
        `relayPublishUrl=${relayPublishUrl} ` +
        `nginxLookupUrl=${nginxStatUrl} nginxFfprobeUrl=${nginxFfprobeUrl} ` +
        `encoderInputUrl=${encoderInputUrl} ` +
        `hostMatch=${hostMatch} portMatch=${portMatch} appMatch=${appMatch} keyMatch=${keyMatch} ` +
        `relayPid=${relayInfo?.pid ?? 'none'} relayPidAlive=${relayRunning} relaySendingBytes=${relaySendingBytes} ` +
        `nginxStreamFound=${nginxStat !== null} nginxBwIn=${nginxStat?.bwIn ?? 'none'} ` +
        `nginxBwVideo=${nginxStat?.bwVideo ?? 'none'} nginxPublishing=${nginxStat?.publishing ?? 'none'} ` +
        `onNginx=${onNginx} encoderConnected=${snapshot.encoderConnected} ` +
        `encoderAlive=${encoderAlive} encoderPlaybackSource=${proc?.playbackSource ?? 'none'} ` +
        `dbSourceHasBusKey=${dbSourceHasBusKey}`
    );

    logger.info(
      `[MCR_BINDING_BITRATE] channelId=${channelId} ` +
        `statsBitrate=${proc?.stats.bitrate ?? 0} statsFps=${proc?.stats.fps ?? 0} ` +
        `statsFrames=${proc?.stats.frames ?? 0} statsSpeed=${proc?.stats.speed ?? '0x'} ` +
        `statsSizeKb=${typeof statsAny?.size === 'number' ? statsAny.size : 'none'} ` +
        `hlsSegmentDerivedKbps=${segBitrate} ` +
        `formula=(latestSegmentBytes*8/segmentGapSec/1000) ` +
        `note=monitor.service overwrites stats.bitrate with hlsSegmentDerivedKbps when >0`
    );
  }

  private hasFreshViewerHls(slug: string, maxAgeMs = 8000): boolean {
    const variantDir = path.join(env.STREAMS_DIR, slug, '720p');
    if (!fs.existsSync(variantDir)) return false;
    const now = Date.now();
    try {
      for (const name of fs.readdirSync(variantDir)) {
        if (!name.endsWith('.ts')) continue;
        const mtime = fs.statSync(path.join(variantDir, name)).mtimeMs;
        if (now - mtime <= maxAgeMs) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  async collectBinding(channelId: string): Promise<McrBindingSnapshot | null> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true, sourceUrl: true, status: true },
    });
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!channel || !router?.enabled) return null;

    const busKey = mcrRelayService.getBusStreamKey(channelId);
    const busUrl = mcrRelayService.getBusRtmpUrl(channelId);
    const relay = mcrRelayService.getRelayInfo(channelId);
    const proc = ffmpegService.getProcessInfo(channelId);
    const onNginx = await mcrIngestService.isStreamPublishing(busKey);
    const relayRunning = mcrRelayService.isRunning(channelId);
    const slateHolding = mcrBusHolderService.isHolding(channelId);

    const busActive = onNginx || relayRunning || slateHolding;
    const busMode = relayRunning ? 'relay' : slateHolding ? 'slate' : onNginx ? 'nginx' : 'idle';
    const programBus =
      `${busUrl} mode=${busMode} onNginx=${onNginx} relay=${relayRunning} slate=${slateHolding}` +
      (relay?.routedSourceId ? ` sourceId=${relay.routedSourceId}` : '');

    const encoderAlive = this.isEncoderAlive(channelId);
    const subscribedToBus =
      encoderAlive &&
      proc?.playbackSource === 'MCR_BUS' &&
      String(channel.sourceUrl).includes(`mcr-${channelId}`);
    const encoderOnline =
      subscribedToBus && !!(proc?.markedOnline || this.hasFreshViewerHls(channel.slug));

    const programEncoder = proc
      ? `pid=${proc.pid} mode=${proc.playbackSource ?? 'unknown'} status=${channel.status} ` +
        `markedOnline=${!!proc.markedOnline} fps=${proc.stats.fps ?? 0} bitrateKbps=${proc.stats.bitrate ?? 0}`
      : 'none';

    const viewerOutput = `/stream/${channel.slug}/master.m3u8`;
    const connected = busActive && subscribedToBus;

    return {
      channelId,
      slug: channel.slug,
      programBus,
      programEncoder,
      viewerOutput,
      connected,
      busActive,
      encoderConnected: subscribedToBus,
      encoderOnline,
      relaySourceId: relay?.routedSourceId ?? null,
    };
  }

  logBinding(snapshot: McrBindingSnapshot, trigger?: string): void {
    const relayRunning = snapshot.programBus.includes('relay=true');
    const onNginx = snapshot.programBus.includes('onNginx=true');
    const encoderConnected = snapshot.encoderConnected;
    logger.info(
      `[MCR_BINDING] channelId=${snapshot.channelId} trigger=${trigger ?? 'audit'} ` +
        `relay=${relayRunning} onNginx=${onNginx} encoder=${encoderConnected ? 'connected' : 'none'} ` +
        `bindingState=${snapshot.connected ? 'bound' : 'disconnected'} ` +
        `programBus=${snapshot.programBus} programEncoder=${snapshot.programEncoder} ` +
        `viewerOutput=${snapshot.viewerOutput}`
    );
  }

  async auditBinding(channelId: string, trigger = 'audit'): Promise<McrBindingSnapshot | null> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true, sourceUrl: true },
    });
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!channel || !router?.enabled) return null;

    const snapshot = await this.collectBinding(channelId);
    if (!snapshot) return null;
    this.logBinding(snapshot, trigger);

    const relayRunning = mcrRelayService.isRunning(channelId);
    const onNginx = await mcrIngestService.isStreamPublishing(
      mcrRelayService.getBusStreamKey(channelId)
    );
    await this.logBindingCompare(channelId, channel, snapshot, relayRunning, onNginx);
    return snapshot;
  }

  /** Fail when program bus is publishing but the program encoder is not bound to it. */
  async assertProgramEncoderBound(channelId: string, trigger = 'assert'): Promise<McrBindingSnapshot> {
    const maxAttempts = trigger === 'TAKE' || trigger === 'CUT' || trigger === 'AUTO' || trigger === 'FADE' ? 8 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const snapshot = await this.collectBinding(channelId);
      if (!snapshot) {
        throw new Error(`MCR binding check failed: channel ${channelId} has no enabled MCR router`);
      }
      this.logBinding(snapshot, `${trigger}#${attempt}`);

      if (!snapshot.busActive || snapshot.encoderConnected) {
        return snapshot;
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 750));
        continue;
      }

      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { slug: true, sourceUrl: true },
      });
      if (channel) {
        await this.logBindingCompare(
          channelId,
          channel,
          snapshot,
          mcrRelayService.isRunning(channelId),
          await mcrIngestService.isStreamPublishing(mcrRelayService.getBusStreamKey(channelId))
        );
      }
      throw new Error(
        `MCR binding failed: program bus active but program encoder disconnected ` +
          `(bus=${snapshot.programBus} encoder=${snapshot.programEncoder})`
      );
    }

    throw new Error(`MCR binding check failed: channel ${channelId}`);
  }

  async logTakeResult(
    channelId: string,
    oldProgram: string | null | undefined,
    newProgram: string | null | undefined
  ): Promise<void> {
    const snapshot = await this.collectBinding(channelId);
    if (!snapshot) return;

    const relayMatchesProgram =
      !!newProgram && snapshot.relaySourceId === newProgram;
    const viewerOutputUpdated =
      snapshot.connected &&
      relayMatchesProgram &&
      (snapshot.encoderOnline || this.hasFreshViewerHls(snapshot.slug));

    logger.info(
      `[MCR_TAKE_RESULT] channelId=${channelId} oldProgram=${oldProgram ?? 'null'} ` +
        `newProgram=${newProgram ?? 'null'} viewerOutputUpdated=${viewerOutputUpdated} ` +
        `programBus=${snapshot.programBus} programEncoder=${snapshot.programEncoder} ` +
        `viewerOutput=${snapshot.viewerOutput} connected=${snapshot.connected}`
    );
  }

  /** Keep channel.status aligned with program encoder health for MCR channels. */
  async syncChannelStatusFromEncoder(channelId: string): Promise<void> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { status: true, slug: true },
    });
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!channel || !router?.enabled || channel.status === 'STOPPING') return;

    const snapshot = await this.collectBinding(channelId);
    if (!snapshot) return;

    const proc = ffmpegService.getProcessInfo(channelId);

    if (proc && snapshot.encoderConnected && snapshot.encoderOnline) {
      if (channel.status !== 'ONLINE') {
        await prisma.channel.update({ where: { id: channelId }, data: { status: 'ONLINE' } });
        wsService.emitChannelStatus(channelId, 'ONLINE');
        logger.info(
          `[MCR_BINDING] channelId=${channelId} action=status-sync status=ONLINE ` +
            `reason=program-encoder-healthy viewerOutput=${snapshot.viewerOutput}`
        );
      }
      return;
    }

    if (snapshot.busActive && !snapshot.encoderConnected && channel.status === 'ONLINE') {
      const channelRow = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { slug: true, sourceUrl: true },
      });
      if (channelRow) {
        await this.logBindingCompare(
          channelId,
          channelRow,
          snapshot,
          mcrRelayService.isRunning(channelId),
          await mcrIngestService.isStreamPublishing(mcrRelayService.getBusStreamKey(channelId))
        );
      }
      await prisma.channel.update({ where: { id: channelId }, data: { status: 'ERROR' } });
      wsService.emitChannelStatus(channelId, 'ERROR');
      logger.warn(
        `[MCR_BINDING] channelId=${channelId} action=status-sync status=ERROR ` +
          `reason=bus-active-encoder-disconnected programBus=${snapshot.programBus}`
      );
    }
  }
}

export const mcrBindingService = new McrBindingService();
