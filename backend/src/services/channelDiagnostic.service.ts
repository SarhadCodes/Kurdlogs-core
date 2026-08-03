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
  endsAt: string;
  status: 'RUNNING' | 'COMPLETE';
  samples: DiagnosticSample[];
  summary: string[];
}

class ChannelDiagnosticService {
  private runs = new Map<string, ChannelDiagnostic>();
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly durationMs = 10 * 60 * 1000;
  private readonly sampleMs = 30 * 1000;

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

  private finish(channelId: string) {
    const run = this.runs.get(channelId);
    if (!run) return;
    run.status = 'COMPLETE';
    run.summary = this.summarize(run);
    const timer = this.timers.get(channelId);
    if (timer) clearInterval(timer);
    this.timers.delete(channelId);
  }

  async start(channelId: string): Promise<ChannelDiagnostic> {
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { slug: true } });
    if (!channel) throw new Error('Channel not found');
    const existing = this.runs.get(channelId);
    if (existing?.status === 'RUNNING') return existing;
    const now = Date.now();
    const run: ChannelDiagnostic = { channelId, slug: channel.slug, startedAt: new Date(now).toISOString(), endsAt: new Date(now + this.durationMs).toISOString(), status: 'RUNNING', samples: [], summary: [] };
    const take = () => {
      run.samples.push(this.inspect(channelId, channel.slug));
      if (Date.now() >= now + this.durationMs) this.finish(channelId);
    };
    take();
    this.runs.set(channelId, run);
    this.timers.set(channelId, setInterval(take, this.sampleMs));
    return run;
  }

  get(channelId: string): ChannelDiagnostic | null {
    const run = this.runs.get(channelId) ?? null;
    if (run?.status === 'RUNNING') run.summary = this.summarize(run);
    return run;
  }
}

export const channelDiagnosticService = new ChannelDiagnosticService();
