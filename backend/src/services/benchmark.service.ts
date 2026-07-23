import os from 'os';
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { ffmpegService } from './ffmpeg.service';
import { channelService } from './channel.service';
import { monitorService } from './monitor.service';
import { appLogService } from './appLog.service';
import { sleep } from '../utils/helpers';

export interface BenchmarkSample {
  at: string;
  systemCpu: number;
  systemRamPct: number;
  activeChannels: number;
  totalFfmpegCpu: number;
  totalFfmpegRamMb: number;
}

export interface BenchmarkReport {
  id: string;
  targetChannels: number;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  samples: BenchmarkSample[];
  summary: {
    avgSystemCpu: number;
    peakSystemCpu: number;
    avgFfmpegCpu: number;
    peakFfmpegCpu: number;
    avgRamPct: number;
    peakRamPct: number;
    diskWriteEstimateKbPerSec: number;
  };
  recommendation: string;
}

class BenchmarkService {
  private lastReport: BenchmarkReport | null = null;
  private running = false;

  getLastReport(): BenchmarkReport | null {
    return this.lastReport;
  }

  isRunning(): boolean {
    return this.running;
  }

  async run(targetChannels: 1 | 5 | 10 | 20, sampleSeconds = 30): Promise<BenchmarkReport> {
    if (this.running) {
      throw new Error('Benchmark already running');
    }
    this.running = true;
    const id = `bench-${Date.now()}`;
    const startedAt = new Date();

    await appLogService.log('BENCHMARK', `Starting benchmark for ${targetChannels} channels`, 'INFO', {
      targetChannels,
    });

    const channels = await prisma.channel.findMany({
      where: { isPlaylistChannel: true },
      include: { transcodingProfile: true, overlays: true, playlist: true },
      take: targetChannels,
    });

    const toStart = channels.slice(0, targetChannels);
    for (const ch of toStart) {
      if (ch.status !== 'ONLINE' && ch.status !== 'STARTING') {
        try {
          await channelService.startChannel(ch.id);
          await sleep(3000);
        } catch {
          /* continue */
        }
      }
    }

    const samples: BenchmarkSample[] = [];
    const diskBefore = this.measureStreamDiskBytes();

    for (let i = 0; i < sampleSeconds; i++) {
      await sleep(1000);
      const procs = ffmpegService.getAllProcesses();
      let totalFfmpegCpu = 0;
      let totalFfmpegRamMb = 0;
      for (const [, info] of procs) {
        totalFfmpegCpu += info.stats.cpu || 0;
        totalFfmpegRamMb += info.stats.ram || 0;
      }

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const ramPct = ((totalMem - freeMem) / totalMem) * 100;

      samples.push({
        at: new Date().toISOString(),
        systemCpu: await this.readSystemCpu(),
        systemRamPct: Math.round(ramPct * 10) / 10,
        activeChannels: procs.size,
        totalFfmpegCpu: Math.round(totalFfmpegCpu * 10) / 10,
        totalFfmpegRamMb: Math.round(totalFfmpegRamMb),
      });
    }

    const diskAfter = this.measureStreamDiskBytes();
    const durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const peak = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);

    const sysCpu = samples.map((s) => s.systemCpu);
    const ffCpu = samples.map((s) => s.totalFfmpegCpu);
    const ram = samples.map((s) => s.systemRamPct);

    const diskDeltaKb = Math.max(0, (diskAfter - diskBefore) / 1024);
    const diskRate = durationSec > 0 ? diskDeltaKb / durationSec : 0;

    const avgSystemCpu = Math.round(avg(sysCpu) * 10) / 10;
    const peakSystemCpu = Math.round(peak(sysCpu) * 10) / 10;

    let recommendation = 'OK for current hardware';
    if (peakSystemCpu > 90) {
      recommendation = 'CRITICAL — reduce channel count or enable GPU encode / worker nodes';
    } else if (peakSystemCpu > 70) {
      recommendation = 'WARNING — limit concurrent channels; prefer offline logo burn';
    } else if (peakSystemCpu > 50) {
      recommendation = 'GOOD — headroom for more ingest jobs during off-peak';
    }

    const report: BenchmarkReport = {
      id,
      targetChannels,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationSec,
      samples,
      summary: {
        avgSystemCpu,
        peakSystemCpu,
        avgFfmpegCpu: Math.round(avg(ffCpu) * 10) / 10,
        peakFfmpegCpu: Math.round(peak(ffCpu) * 10) / 10,
        avgRamPct: Math.round(avg(ram) * 10) / 10,
        peakRamPct: Math.round(peak(ram) * 10) / 10,
        diskWriteEstimateKbPerSec: Math.round(diskRate),
      },
      recommendation,
    };

    this.lastReport = report;
    this.running = false;

    await appLogService.log('BENCHMARK', `Benchmark complete: peak CPU ${peakSystemCpu}%`, 'INFO', {
      reportId: id,
      summary: report.summary,
    });

    return report;
  }

  private async readSystemCpu(): Promise<number> {
    return monitorService.getSystemCpuPercent();
  }

  private measureStreamDiskBytes(): number {
    const root = env.STREAMS_DIR;
    if (!fs.existsSync(root)) return 0;
    let total = 0;
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else total += st.size;
      }
    };
    try {
      walk(root);
    } catch {
      /* ignore */
    }
    return total;
  }
}

export const benchmarkService = new BenchmarkService();
