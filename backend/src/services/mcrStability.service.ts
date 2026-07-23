import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import { mcrSourceSessionService } from './mcrSourceSession.service';
import { mcrBindingService } from './mcrBinding.service';
import { getStreamRoot } from '../utils/streamPaths';

const MONITOR_INTERVAL_MS = 3000;
const HLS_STALL_THRESHOLD_MS = 5000;
const OUTPUT_HEALTH_INTERVAL_MS = 30000;

class McrStabilityService {
  private monitorTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private lastSegmentAt = new Map<string, number>();
  private stallLogged = new Map<string, number>();

  start(): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => void this.runMonitor(), MONITOR_INTERVAL_MS);
    this.healthTimer = setInterval(() => void this.logOutputHealth(), OUTPUT_HEALTH_INTERVAL_MS);
    logger.info('[MCR_STABILITY] broadcast stability monitor started');
  }

  stop(): void {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.monitorTimer = null;
    this.healthTimer = null;
  }

  private async runMonitor(): Promise<void> {
    const routers = await prisma.mcrRouterState.findMany({
      where: { enabled: true },
      include: { sources: { where: { enabled: true } } },
    });

    for (const router of routers) {
      const channel = await prisma.channel.findUnique({
        where: { id: router.channelId },
        select: { slug: true },
      });
      if (!channel) continue;

      this.checkProgramHlsStall(router.channelId, channel.slug);
      await mcrBindingService.syncChannelStatusFromEncoder(router.channelId);

      for (const source of router.sources) {
        mcrSourceSessionService.tickSessionHealth(router.channelId, source.id);
        this.checkSessionPreviewStall(router.channelId, source.id);
      }
    }
  }

  private checkProgramHlsStall(channelId: string, slug: string): void {
    const variantDir = path.join(env.STREAMS_DIR, slug, '720p');
    const latest = this.findLatestSegmentMtime(variantDir);
    if (!latest) return;

    const prev = this.lastSegmentAt.get(`prog:${channelId}`) ?? latest;
    if (latest > prev) {
      this.lastSegmentAt.set(`prog:${channelId}`, latest);
      this.stallLogged.delete(`prog:${channelId}`);
      return;
    }

    const stallMs = Date.now() - latest;
    if (stallMs < HLS_STALL_THRESHOLD_MS) return;

    const lastLog = this.stallLogged.get(`prog:${channelId}`) ?? 0;
    if (Date.now() - lastLog < HLS_STALL_THRESHOLD_MS) return;
    this.stallLogged.set(`prog:${channelId}`, Date.now());

    const proc = ffmpegService.getProcessInfo(channelId);
    logger.warn(
      `[MCR_HLS_STALL] channelId=${channelId} slug=${slug} stage=PROGRAM_ENCODER ` +
        `stallMs=${stallMs} encoderPid=${proc?.pid ?? 'none'} ` +
        `fps=${proc?.stats.fps ?? 0} bitrateKbps=${proc?.stats.bitrate ?? 0}`
    );
  }

  private checkSessionPreviewStall(channelId: string, sourceId: string): void {
    const sessionKey = mcrSourceSessionService.getSessionKey(channelId, sourceId);
    const root = getStreamRoot(sessionKey);
    const latest = this.findLatestSegmentMtime(root);
    if (!latest) return;

    const key = `sess:${channelId}:${sourceId}`;
    const prev = this.lastSegmentAt.get(key) ?? latest;
    if (latest > prev) {
      this.lastSegmentAt.set(key, latest);
      this.stallLogged.delete(key);
      return;
    }

    const stallMs = Date.now() - latest;
    if (stallMs < HLS_STALL_THRESHOLD_MS) return;
    if (!mcrSourceSessionService.isRunning(channelId, sourceId)) return;

    const lastLog = this.stallLogged.get(key) ?? 0;
    if (Date.now() - lastLog < HLS_STALL_THRESHOLD_MS) return;
    this.stallLogged.set(key, Date.now());

    logger.warn(
      `[MCR_HLS_STALL] channelId=${channelId} sourceId=${sourceId} sessionKey=${sessionKey} ` +
        `stage=MCR_SESSION stallMs=${stallMs}`
    );
  }

  private findLatestSegmentMtime(dir: string): number | null {
    if (!fs.existsSync(dir)) return null;
    let latest = 0;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.ts')) continue;
        const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
        if (mtime > latest) latest = mtime;
      }
    } catch {
      return null;
    }
    return latest > 0 ? latest : null;
  }

  private async logOutputHealth(): Promise<void> {
    const routers = await prisma.mcrRouterState.findMany({
      where: { enabled: true },
      select: { channelId: true, programSourceId: true, previewSourceId: true },
    });

    for (const router of routers) {
      const channel = await prisma.channel.findUnique({
        where: { id: router.channelId },
        select: { slug: true, status: true },
      });
      const proc = ffmpegService.getProcessInfo(router.channelId);
      const progSeg = this.lastSegmentAt.get(`prog:${router.channelId}`) ?? 0;
      const previewMetrics = router.previewSourceId
        ? mcrSourceSessionService.getSessionMetrics(router.channelId, router.previewSourceId)
        : null;
      const programMetrics = router.programSourceId
        ? mcrSourceSessionService.getSessionMetrics(router.channelId, router.programSourceId)
        : null;

      logger.info(
        `[MCR_OUTPUT_HEALTH] channelId=${router.channelId} slug=${channel?.slug ?? 'unknown'} ` +
          `channelStatus=${channel?.status ?? 'unknown'} encoderPid=${proc?.pid ?? 'none'} ` +
          `encoderFps=${proc?.stats.fps ?? 0} encoderBitrateKbps=${proc?.stats.bitrate ?? 0} ` +
          `lastSegmentAt=${progSeg || 'none'} currentProgram=${router.programSourceId ?? 'none'} ` +
          `currentPreview=${router.previewSourceId ?? 'none'} ` +
          `programSourceFps=${programMetrics?.fps ?? 0} previewSourceFps=${previewMetrics?.fps ?? 0}`
      );

      void mcrBindingService.auditBinding(router.channelId, 'output-health');
    }
  }
}

export const mcrStabilityService = new McrStabilityService();
