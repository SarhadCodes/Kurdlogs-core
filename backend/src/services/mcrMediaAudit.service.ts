import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildMcrRtmpUrl } from '../config/mcrRtmp';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import { mcrRelayService } from './mcrRelay.service';
import { mcrBusHolderService } from './mcrBusHolder.service';
import { mcrIngestService } from './mcrIngest.service';

const execFileAsync = promisify(execFile);

export type McrMediaStage =
  | 'SOURCE'
  | 'MCR_SESSION'
  | 'PROGRAM_BUS_RELAY'
  | 'PROGRAM_BUS_SLATE'
  | 'PROGRAM_ENCODER'
  | 'VIEWER_HLS';

export interface McrMediaStageReport {
  stage: McrMediaStage;
  processName: string;
  pid: number | null;
  inputUrl: string;
  outputUrl: string;
  codec: string;
  fps: number | null;
  bitrateKbps: number | null;
  transcode: boolean;
  decode: boolean;
  cpuPercent: number | null;
  cmd: string;
}

class McrMediaAuditService {
  async auditChannel(channelId: string, channelSlug: string, trigger = 'manual'): Promise<void> {
    const stages = await this.collectStages(channelId, channelSlug);
    const ffmpegCount = stages.filter((s) => s.pid).length;

    logger.info(
      `[MCR_MEDIA_PATH] channelId=${channelId} slug=${channelSlug} trigger=${trigger} ` +
        `ffmpegProcesses=${ffmpegCount} stages=${stages.length}`
    );

    for (const s of stages) {
      logger.info(
        `[MCR_FFMPEG_PROCESS] stage=${s.stage} name=${s.processName} pid=${s.pid ?? 'none'} ` +
          `input=${s.inputUrl.slice(0, 160)} output=${s.outputUrl.slice(0, 160)} ` +
          `codec=${s.codec} fps=${s.fps ?? 'unknown'} bitrateKbps=${s.bitrateKbps ?? 'unknown'} ` +
          `transcode=${s.transcode} decode=${s.decode} cpu=${s.cpuPercent ?? 'unknown'}% ` +
          `cmd=${s.cmd.slice(0, 220)}`
      );
    }

    const session = stages.find((s) => s.stage === 'MCR_SESSION');
    const bus = stages.find((s) => s.stage === 'PROGRAM_BUS_RELAY' || s.stage === 'PROGRAM_BUS_SLATE');
    const encoder = stages.find((s) => s.stage === 'PROGRAM_ENCODER');

    if (session) {
      logger.info(
        `[MCR_SOURCE_STATS] channelId=${channelId} pid=${session.pid} fps=${session.fps ?? 'unknown'} ` +
          `bitrateKbps=${session.bitrateKbps ?? 'unknown'} transcode=${session.transcode} decode=${session.decode}`
      );
    }

    if (bus) {
      const busKey = mcrRelayService.getBusStreamKey(channelId);
      const onNginx = await mcrIngestService.isStreamPublishing(busKey);
      logger.info(
        `[MCR_BUS_STATS] channelId=${channelId} busKey=${busKey} pid=${bus.pid} ` +
          `mode=${bus.stage} transcode=${bus.transcode} decode=${bus.decode} ` +
          `nginxPublisherVisible=${onNginx} relayRunning=${mcrRelayService.isRunning(channelId)} ` +
          `slateHolding=${mcrBusHolderService.isHolding(channelId)}`
      );
    }

    if (encoder) {
      logger.info(
        `[MCR_OUTPUT_STATS] channelId=${channelId} slug=${channelSlug} pid=${encoder.pid} ` +
          `fps=${encoder.fps ?? 'unknown'} bitrateKbps=${encoder.bitrateKbps ?? 'unknown'} ` +
          `transcode=${encoder.transcode} decode=${encoder.decode} ` +
          `viewerEndpoint=/stream/${channelSlug}/master.m3u8`
      );

      if (session?.fps && encoder.fps && encoder.fps < session.fps * 0.85) {
        logger.warn(
          `[MCR_FRAME_DROP] channelId=${channelId} sourceFps=${session.fps} outputFps=${encoder.fps} ` +
            `dropPct=${Math.round((1 - encoder.fps / session.fps) * 100)} ` +
            `likelyCause=program-encoder-transcode-or-fps-filter`
        );
      }
    }

    const transcodeStages = stages.filter((s) => s.transcode);
    if (transcodeStages.length > 1) {
      logger.warn(
        `[MCR_BUFFER_STATS] channelId=${channelId} transcodeStages=${transcodeStages.length} ` +
          `stages=${transcodeStages.map((s) => s.stage).join(',')} — redundant encode passes increase lag`
      );
    }

    const totalCpu = stages.reduce((sum, s) => sum + (s.cpuPercent ?? 0), 0);
    logger.info(
      `[MCR_BUFFER_STATS] channelId=${channelId} totalFfmpegCpu=${totalCpu.toFixed(1)}% ` +
        `processCount=${ffmpegCount} copyCapableBus=${bus ? !bus.transcode : 'n/a'}`
    );
  }

  private async collectStages(channelId: string, channelSlug: string): Promise<McrMediaStageReport[]> {
    const reports: McrMediaStageReport[] = [];
    const procs = await this.listFfmpegProcesses();

    const relay = mcrRelayService.getRelayInfo(channelId);
    if (relay) {
      const cmd = procs.find((p) => p.pid === relay.pid)?.cmd ?? 'unknown';
      reports.push({
        stage: 'PROGRAM_BUS_RELAY',
        processName: 'mcr-bus-relay',
        pid: relay.pid,
        inputUrl: relay.inputUrl,
        outputUrl: mcrRelayService.getBusRtmpUrl(channelId),
        codec: /(-c copy|-codec copy)/.test(cmd) && !cmd.includes('libx264') ? 'copy' : 'libx264',
        fps: null,
        bitrateKbps: null,
        transcode: !/(-c copy|-codec copy)/.test(cmd) || cmd.includes('libx264'),
        decode: !/(-c copy|-codec copy)/.test(cmd) || cmd.includes('libx264'),
        cpuPercent: await this.getCpuPercent(relay.pid),
        cmd,
      });
    } else if (mcrBusHolderService.isHolding(channelId)) {
      const busUrl = mcrRelayService.getBusRtmpUrl(channelId);
      const slateProc = procs.find((p) => p.cmd.includes(busUrl) && p.cmd.includes('color=c=black'));
      reports.push({
        stage: 'PROGRAM_BUS_SLATE',
        processName: 'mcr-bus-slate',
        pid: slateProc?.pid ?? null,
        inputUrl: 'lavfi:color+anullsrc',
        outputUrl: busUrl,
        codec: 'libx264',
        fps: 25,
        bitrateKbps: null,
        transcode: true,
        decode: false,
        cpuPercent: slateProc ? await this.getCpuPercent(slateProc.pid) : null,
        cmd: slateProc?.cmd ?? 'slate',
      });
    }

    const encoderInfo = ffmpegService.getProcessInfo(channelId);
    if (encoderInfo) {
      const cmd = procs.find((p) => p.pid === encoderInfo.pid)?.cmd ?? 'unknown';
      const isCopy = /-c:v copy/.test(cmd) && !/-c:v libx264/.test(cmd);
      reports.push({
        stage: 'PROGRAM_ENCODER',
        processName: 'program-hls-encoder',
        pid: encoderInfo.pid,
        inputUrl: buildMcrRtmpUrl(`mcr-${channelId}`),
        outputUrl: `/var/streams/${channelSlug}/master.m3u8`,
        codec: isCopy ? 'copy→HLS' : 'libx264→HLS',
        fps: encoderInfo.stats.fps ?? null,
        bitrateKbps: encoderInfo.stats.bitrate ?? null,
        transcode: !isCopy,
        decode: !isCopy,
        cpuPercent: await this.getCpuPercent(encoderInfo.pid),
        cmd,
      });
    }

    reports.push({
      stage: 'VIEWER_HLS',
      processName: 'viewer-endpoint',
      pid: null,
      inputUrl: `/var/streams/${channelSlug}/master.m3u8`,
      outputUrl: `/stream/${channelSlug}/master.m3u8`,
      codec: 'HLS',
      fps: encoderInfo?.stats.fps ?? null,
      bitrateKbps: encoderInfo?.stats.bitrate ?? null,
      transcode: false,
      decode: false,
      cpuPercent: null,
      cmd: 'nginx/static-hls',
    });

    for (const p of procs) {
      if (!p.cmd.includes(`mcr-sess-${channelId.slice(0, 8)}`)) continue;
      const sessionKeyMatch = p.cmd.match(/live\/(mcr-sess-[^/\s|]+)/);
      const sessionKey = sessionKeyMatch?.[1] ?? 'unknown';
      const inputMatch = p.cmd.match(/-i\s+(\S+)/);
      reports.push({
        stage: 'MCR_SESSION',
        processName: `session:${sessionKey}`,
        pid: p.pid,
        inputUrl: inputMatch?.[1] ?? 'unknown',
        outputUrl: buildMcrRtmpUrl(sessionKey),
        codec: p.cmd.includes('libx264') ? 'libx264' : 'copy',
        fps: null,
        bitrateKbps: null,
        transcode: p.cmd.includes('libx264'),
        decode: p.cmd.includes('libx264'),
        cpuPercent: await this.getCpuPercent(p.pid),
        cmd: p.cmd,
      });
    }

    return reports;
  }

  private async listFfmpegProcesses(): Promise<Array<{ pid: number; cmd: string }>> {
    try {
      const { stdout } = await execFileAsync('ps', ['-o', 'pid,args']);
      return stdout
        .split('\n')
        .slice(1)
        .filter((line) => line.includes('ffmpeg'))
        .map((line) => {
          const match = line.trim().match(/^(\d+)\s+(.+)$/);
          if (!match) return null;
          return { pid: parseInt(match[1], 10), cmd: match[2] };
        })
        .filter((p): p is { pid: number; cmd: string } => p !== null && !Number.isNaN(p.pid));
    } catch {
      return [];
    }
  }

  private async getCpuPercent(pid: number): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', '%cpu=']);
      const val = parseFloat(stdout.trim());
      return Number.isNaN(val) ? null : val;
    } catch {
      return null;
    }
  }
}

export const mcrMediaAuditService = new McrMediaAuditService();
