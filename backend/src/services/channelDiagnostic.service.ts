import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { ffmpegService } from './ffmpeg.service';
import { hasRecentHlsSegments } from '../utils/streamPaths';

export interface DiagnosticSample {
  at: string;
  processRunning: boolean;
  hlsPlayable: boolean;
  manifestAgeSec: number | null;
  newestSegmentAgeSec: number | null;
  newestSegment: string | null;
  manifestEnded: boolean;
  cpu: number;
  fps: number;
  speed: string;
  bitrate: number;
}

export interface ChannelDiagnostic {
  channelId: string;
  slug: string;
  startedAt: string;
  endsAt: string | null;
  status: 'RUNNING';
  samples: DiagnosticSample[];
  summary: string[];
}

class ChannelDiagnosticService {
  private runs = new Map<string, ChannelDiagnostic>();
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly sampleMs = 30 * 1000;
  private readonly maxSamples = 7 * 24 * 60 * 2;
  private fleetTimer: NodeJS.Timeout | null = null;

  private publicReport(run: ChannelDiagnostic): ChannelDiagnostic {
    return {
      ...run,
      // Keep polling responses bounded even after the recorder has run for
      // days. Full retention remains in memory/on disk for diagnosis.
      samples: run.samples.slice(-500),
      summary: [...run.summary],
    };
  }

  private diagnosticPath(channelId: string): string {
    return path.join(env.STREAMS_DIR, 'diagnostics', `${channelId}.jsonl`);
  }

  private loadHistory(channelId: string): DiagnosticSample[] {
    const file = this.diagnosticPath(channelId);
    if (!fs.existsSync(file)) return [];
    try {
      return fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-this.maxSamples)
        .map((line) => JSON.parse(line) as DiagnosticSample);
    } catch {
      return [];
    }
  }

  private persistSample(channelId: string, sample: DiagnosticSample): void {
    const file = this.diagnosticPath(channelId);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(sample)}\n`, 'utf8');
      const stat = fs.statSync(file);
      if (stat.size <= 10 * 1024 * 1024) return;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
      fs.writeFileSync(file, `${lines.slice(-this.maxSamples).join('\n')}\n`, 'utf8');
    } catch {
      // The live watchdog remains authoritative if diagnostic persistence fails.
    }
  }

  private inspect(channelId: string, slug: string): DiagnosticSample {
    const now = Date.now();
    const variantDir = path.join(env.STREAMS_DIR, slug, '720p');
    const manifest = path.join(variantDir, 'index.m3u8');
    let manifestAgeSec: number | null = null;
    let newestSegmentAgeSec: number | null = null;
    let newestSegment: string | null = null;
    let manifestEnded = false;
    try {
      const body = fs.readFileSync(manifest, 'utf8');
      manifestAgeSec = Math.max(0, (now - fs.statSync(manifest).mtimeMs) / 1000);
      manifestEnded = body.includes('#EXT-X-ENDLIST');
      const last = body.split(/\r?\n/).filter((line) => line && !line.startsWith('#')).at(-1);
      if (last?.endsWith('.ts')) {
        newestSegment = last;
        const segment = path.join(variantDir, last);
        if (fs.existsSync(segment)) newestSegmentAgeSec = Math.max(0, (now - fs.statSync(segment).mtimeMs) / 1000);
      }
    } catch { /* absence is diagnostic data */ }
    const proc = ffmpegService.getProcessInfo(channelId);
    return {
      at: new Date().toISOString(),
      processRunning: !!proc,
      hlsPlayable: hasRecentHlsSegments(slug),
      manifestAgeSec,
      newestSegmentAgeSec,
      newestSegment,
      manifestEnded,
      cpu: proc?.stats.cpu ?? 0,
      fps: proc?.stats.fps ?? 0,
      speed: proc?.stats.speed ?? '0x',
      bitrate: proc?.stats.bitrate ?? 0,
    };
  }

  private summarize(run: ChannelDiagnostic): string[] {
    const samples = run.samples;
    if (!samples.length) return ['No samples were captured.'];
    // An HLS encoder needs a short period to produce a new manifest and segment
    // after a channel is started. Treat that warm-up as baseline collection, not
    // as an on-air failure, otherwise every diagnostic started after a recovery
    // would report a false freeze.
    const settledSamples = samples.filter((sample) =>
      Date.parse(sample.at) - Date.parse(run.startedAt) >= 60_000,
    );
    if (!settledSamples.length) {
      return ['Collecting the one-minute post-start baseline before evaluating HLS health.'];
    }
    const stale = settledSamples.filter((s) => !s.hlsPlayable || (s.manifestAgeSec ?? Infinity) > 30);
    const ended = settledSamples.filter((s) => s.manifestEnded);
    const noProc = settledSamples.filter((s) => !s.processRunning);
    const slow = settledSamples.filter((s) => { const n = parseFloat(s.speed); return n > 0 && n < 0.9; });
    const total = settledSamples.length;
    const messages: string[] = [];
    if (noProc.length) messages.push(`Encoder missing in ${noProc.length}/${total} settled samples — channel process stopped.`);
    if (ended.length) messages.push(`HLS playlist contained ENDLIST in ${ended.length}/${total} settled samples — output was finalized instead of live.`);
    if (stale.length) messages.push(`HLS was stale or unplayable in ${stale.length}/${total} settled samples — inspect FFmpeg and segment delivery.`);
    if (slow.length) messages.push(`Encoder speed below 0.90x in ${slow.length}/${total} settled samples — CPU/encoder cannot keep up.`);
    if (!messages.length) messages.push('No encoder or HLS stall was detected during this 10-minute capture. If playback still freezes, export this report and compare client/network timestamps.');
    return messages;
  }

  async start(channelId: string): Promise<ChannelDiagnostic> {
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { slug: true } });
    if (!channel) throw new Error('Channel not found');
    const existing = this.runs.get(channelId);
    if (existing) return this.publicReport(existing);
    const now = Date.now();
    const history = this.loadHistory(channelId);
    const run: ChannelDiagnostic = {
      channelId,
      slug: channel.slug,
      startedAt: history[0]?.at ?? new Date(now).toISOString(),
      endsAt: null,
      status: 'RUNNING',
      samples: history,
      summary: [],
    };
    const take = () => {
      const sample = this.inspect(channelId, channel.slug);
      run.samples.push(sample);
      if (run.samples.length > this.maxSamples) {
        run.samples.splice(0, run.samples.length - this.maxSamples);
      }
      run.summary = this.summarize(run);
      this.persistSample(channelId, sample);
    };
    take();
    this.runs.set(channelId, run);
    this.timers.set(channelId, setInterval(take, this.sampleMs));
    return this.publicReport(run);
  }

  async startContinuousMonitoring(): Promise<void> {
    if (this.fleetTimer) return;
    const discover = async () => {
      const channels = await prisma.channel.findMany({
        where: { status: { in: ['ONLINE', 'STARTING', 'ERROR'] } },
        select: { id: true },
      });
      await Promise.all(channels.map((channel) => this.start(channel.id)));
    };
    await discover();
    this.fleetTimer = setInterval(() => void discover().catch(() => {}), 60_000);
  }

  get(channelId: string): ChannelDiagnostic | null {
    const run = this.runs.get(channelId) ?? null;
    if (run) run.summary = this.summarize(run);
    return run ? this.publicReport(run) : null;
  }
}

export const channelDiagnosticService = new ChannelDiagnosticService();
