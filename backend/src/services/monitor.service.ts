import os from 'os';
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { ffmpegService } from './ffmpeg.service';
import { gpuEncoderService } from './gpuEncoder.service';
import { wsService } from './websocket.service';
import { logger } from '../utils/logger';

interface CpuSnapshot {
  idle: number;
  total: number;
}

interface ProcCpuEntry {
  ticks: number;
  wallMs: number;
}

const CLK_TCK = 100;
const NUM_CPUS = os.cpus().length || 1;

class MonitorService {
  private monitorInterval: NodeJS.Timeout | null = null;
  private prevCpu: CpuSnapshot | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private hasGpu: boolean | null = null;
  private lastGpuUsage: number = 0;
  private prevProcCpu: Map<number, ProcCpuEntry> = new Map();

  startMonitoring() {
    if (this.monitorInterval) return;

    this.prevCpu = this.takeCpuSnapshot();

    this.monitorInterval = setInterval(async () => {
      try {
        await this.collectAndBroadcast();
      } catch (err: any) {
        logger.error('Monitor tick error:', err.message);
      }
    }, 10_000);

    this.cleanupInterval = setInterval(() => {
      this.cleanOldData(7).catch(() => {});
    }, 6 * 3600 * 1000);

    logger.info('Monitoring service started');
  }

  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async collectAndBroadcast() {
    const runningProcesses = ffmpegService.getAllProcesses();
    const gpuUsage = this.measureGpu();

    const channelIds = [...runningProcesses.keys()];
    const channels = channelIds.length > 0
      ? await prisma.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, slug: true } })
      : [];
    const slugMap = new Map(channels.map(c => [c.id, c.slug]));

    for (const [channelId, processInfo] of runningProcesses.entries()) {
      const memMb = this.readProcessMemory(processInfo.pid);
      if (memMb !== null) processInfo.stats.ram = memMb;

      const cpuPct = this.readProcessCpu(processInfo.pid);
      if (cpuPct !== null) processInfo.stats.cpu = cpuPct;

      processInfo.stats.uptime = Math.floor((Date.now() - processInfo.startTime.getTime()) / 1000);
      processInfo.stats.gpu = gpuUsage;

      const slug = slugMap.get(channelId);
      if (slug) {
        const segBitrate = this.measureBitrate(slug);
        if (segBitrate > 0) processInfo.stats.bitrate = segBitrate;
      }

      await prisma.streamStats.create({
        data: {
          channelId,
          cpu: processInfo.stats.cpu || 0,
          ram: processInfo.stats.ram || 0,
          bitrate: processInfo.stats.bitrate || 0,
          fps: processInfo.stats.fps || 0,
          uptime: processInfo.stats.uptime || 0,
          frames: processInfo.stats.frames || 0,
          speed: processInfo.stats.speed || '0x',
        },
      });

      wsService.emitChannelStats(channelId, processInfo.stats);
    }

    this.broadcastSystemStats();
  }

  private broadcastSystemStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPercent = ((totalMem - freeMem) / totalMem) * 100;

    const cpuPercent = this.measureCpu();

    const stats = {
      cpu: Math.round(cpuPercent * 10) / 10,
      ram: Math.round(memPercent * 10) / 10,
      totalChannels: ffmpegService.getAllProcesses().size,
      uptime: os.uptime(),
    };

    wsService.emitSystemStats(stats);
  }

  // ─── System-wide CPU (delta-based) ────────────────────────

  private takeCpuSnapshot(): CpuSnapshot {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += (cpu.times as any)[type];
      }
      idle += cpu.times.idle;
    }
    return { idle, total };
  }

  /** Public CPU reading for REST benchmark / monitoring endpoints. */
  getSystemCpuPercent(): number {
    return this.measureCpu();
  }

  private measureCpu(): number {
    const current = this.takeCpuSnapshot();
    if (!this.prevCpu) {
      this.prevCpu = current;
      return 0;
    }
    const idleDelta = current.idle - this.prevCpu.idle;
    const totalDelta = current.total - this.prevCpu.total;
    this.prevCpu = current;
    if (totalDelta === 0) return 0;
    return ((totalDelta - idleDelta) / totalDelta) * 100;
  }

  // ─── Per-process CPU from /proc/<pid>/stat ────────────────

  private readProcessCpu(pid: number): number | null {
    try {
      const statPath = `/proc/${pid}/stat`;
      if (!fs.existsSync(statPath)) return null;
      const content = fs.readFileSync(statPath, 'utf8');

      const closeParen = content.lastIndexOf(')');
      if (closeParen === -1) return null;
      const fields = content.slice(closeParen + 2).split(' ');
      const utime = parseInt(fields[11], 10) || 0;
      const stime = parseInt(fields[12], 10) || 0;
      const totalTicks = utime + stime;
      const nowMs = Date.now();

      const prev = this.prevProcCpu.get(pid);
      this.prevProcCpu.set(pid, { ticks: totalTicks, wallMs: nowMs });

      if (!prev) return null;

      const tickDelta = totalTicks - prev.ticks;
      const wallDelta = (nowMs - prev.wallMs) / 1000;
      if (wallDelta <= 0) return null;

      const cpuPct = (tickDelta / CLK_TCK / wallDelta) * 100;
      return Math.round(cpuPct * 10) / 10;
    } catch {
      return null;
    }
  }

  // ─── GPU measurement (from shared file or nvidia-smi) ──────

  private measureGpu(): number {
    try {
      const gpuFile = '/var/shared/gpu_usage.txt';
      if (fs.existsSync(gpuFile)) {
        const content = fs.readFileSync(gpuFile, 'utf8').trim();
        const val = parseInt(content, 10);
        if (!isNaN(val) && val >= 0) {
          if (!this.hasGpu) {
            this.hasGpu = true;
            logger.info(`GPU monitoring active (reading from sidecar).`);
          }
          this.lastGpuUsage = val;
          return val;
        }
      }
    } catch { /* file not available yet */ }

    const nvencUtil = gpuEncoderService.measureGpuUtilization();
    if (nvencUtil > 0) {
      this.hasGpu = true;
      this.lastGpuUsage = nvencUtil;
      return nvencUtil;
    }

    if (this.hasGpu === null) {
      this.hasGpu = gpuEncoderService.getStatus().runtimeAvailable.nvenc;
      this.lastGpuUsage = 0;
    }
    return this.lastGpuUsage;
  }

  // ─── Bitrate from HLS segment files ───────────────────────

  private measureBitrate(slug: string): number {
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
      const segDuration = (latest.mtime - prev.mtime) / 1000;
      if (segDuration <= 0 || segDuration > 30) return 0;

      return Math.round((latest.size * 8) / segDuration / 1000);
    } catch {
      return 0;
    }
  }

  // ─── Per-process memory from /proc (Linux/Docker) ─────────

  private readProcessMemory(pid: number): number | null {
    try {
      const statusPath = `/proc/${pid}/status`;
      if (!fs.existsSync(statusPath)) return null;
      const content = fs.readFileSync(statusPath, 'utf8');
      const match = content.match(/VmRSS:\s+(\d+)\s+kB/);
      if (match) return Math.round(parseInt(match[1], 10) / 1024);
    } catch { /* not available on non-Linux */ }
    return null;
  }

  // ─── Log management ───────────────────────────────────────

  async addLog(channelId: string, level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string) {
    try {
      const log = await prisma.streamLog.create({
        data: { channelId, level, message },
      });
      wsService.emitLog(channelId, log);
      return log;
    } catch (err: any) {
      logger.error(`Failed to save log for channel ${channelId}: ${err.message}`);
      return null;
    }
  }

  async getChannelLogs(channelId: string, limit = 100) {
    return await prisma.streamLog.findMany({
      where: { channelId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  async clearChannelLogs(channelId: string) {
    return await prisma.streamLog.deleteMany({
      where: { channelId },
    });
  }

  async cleanOldData(daysToKeep = 7) {
    const threshold = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

    const [statsResult, logsResult] = await Promise.all([
      prisma.streamStats.deleteMany({ where: { timestamp: { lt: threshold } } }),
      prisma.streamLog.deleteMany({ where: { timestamp: { lt: threshold } } }),
    ]);

    if (statsResult.count > 0 || logsResult.count > 0) {
      logger.info(`Cleaned ${statsResult.count} old stats and ${logsResult.count} old logs.`);
    }
  }
}

export const monitorService = new MonitorService();
