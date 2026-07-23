import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { ProcessingJobType } from '@prisma/client';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { parseFfmpegProgress } from '../utils/helpers';
import { wsService } from './websocket.service';
import { overlayService, type LogoBurnConfig } from './overlay.service';
import { brandResolverService } from './brandResolver.service';
import { appLogService } from './appLog.service';
import { processingQueueService } from './processingQueue.service';

export type NormalizeCodecMode = 'legacy' | 'avc1';

export const OUT_W = 1280;
export const OUT_H = 720;
export const PLAYLIST_FPS = 24;
const PRESET = env.NORMALIZE_PRESET || 'ultrafast';
const BEFORE_INPUT = ['-fflags', '+genpts+discardcorrupt'];
const FAST_X264 = ['-x264-params', 'ref=1:bframes=0:me=dia:subme=0:8x8dct=0:weightp=0'];

export interface VideoProbe {
  codec: string;
  width: number;
  height: number;
  pixFmt: string;
  fps: number;
  audioCodec: string | null;
  durationSec: number;
}

export interface IngestOptions {
  itemId: string;
  sourcePath: string;
  playlistId: string;
  codecMode?: NormalizeCodecMode;
  /** Explicit brand — if omitted, resolves from item/playlist/channel. */
  brandConfig?: LogoBurnConfig | null;
  jobType?: ProcessingJobType;
  /** When true, skip brand even if profile exists (normalize-only upload). */
  skipBrand?: boolean;
}

class IngestService {
  private activeItems = new Set<string>();

  getNormalizedDir(): string {
    const dir = path.join(env.UPLOADS_DIR, 'normalized');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getNormalizedPath(itemId: string): string {
    return path.join(this.getNormalizedDir(), `${itemId}.mp4`);
  }

  private ffprobePath(): string {
    return env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  }

  resolveSourcePath(item: { id: string; sourceVideoPath?: string | null; videoPath: string }): string | null {
    const dir = path.join(env.UPLOADS_DIR, 'sources');
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(`${item.id}.`)) {
          const full = path.join(dir, name);
          if (fs.existsSync(full)) return full;
        }
      }
    }
    const candidates = [item.sourceVideoPath, item.videoPath].filter(Boolean) as string[];
    for (const p of candidates) {
      if (p.includes(`${path.sep}normalized${path.sep}`)) continue;
      if (fs.existsSync(p)) return p;
    }
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private parseFps(rate?: string): number {
    if (!rate) return 0;
    const parts = rate.split('/').map(Number);
    if (parts.length === 2 && parts[1]) return parts[0] / parts[1];
    return parts[0] || 0;
  }

  async probeInput(inputPath: string): Promise<VideoProbe | null> {
    return new Promise((resolve) => {
      const probe = spawn(this.ffprobePath(), [
        '-v', 'error',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        inputPath,
      ]);
      let output = '';
      probe.stdout.on('data', (d) => { output += d.toString(); });
      probe.on('close', (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }
        try {
          const data = JSON.parse(output);
          const video = (data.streams || []).find((s: any) => s.codec_type === 'video');
          const audio = (data.streams || []).find((s: any) => s.codec_type === 'audio');
          if (!video) {
            resolve(null);
            return;
          }
          const dur = parseFloat(data.format?.duration || '0') || 0;
          resolve({
            codec: String(video.codec_name || '').toLowerCase(),
            width: Number(video.width) || 0,
            height: Number(video.height) || 0,
            pixFmt: String(video.pix_fmt || '').toLowerCase(),
            fps: this.parseFps(video.avg_frame_rate || video.r_frame_rate),
            audioCodec: audio ? String(audio.codec_name || '').toLowerCase() : null,
            durationSec: dur,
          });
        } catch {
          resolve(null);
        }
      });
      probe.on('error', () => resolve(null));
    });
  }

  isRemuxCompatible(probe: VideoProbe, targetW = OUT_W, targetH = OUT_H): boolean {
    if (probe.codec !== 'h264') return false;
    if (!['yuv420p', 'yuvj420p'].includes(probe.pixFmt)) return false;
    if (probe.audioCodec && probe.audioCodec !== 'aac') return false;
    if (probe.width > targetW || probe.height > targetH) return false;
    if (probe.fps > 0 && Math.abs(probe.fps - PLAYLIST_FPS) > 0.6) return false;
    return true;
  }

  private vfStandard(): string {
    return (
      `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,` +
      `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,fps=${PLAYLIST_FPS},setpts=PTS-STARTPTS,format=yuv420p`
    );
  }

  private appendOutCodecs(args: string[], codecMode: NormalizeCodecMode): void {
    args.push(
      '-c:v', 'libx264',
      '-preset', PRESET,
      '-tune', 'zerolatency',
      ...FAST_X264,
      '-pix_fmt', 'yuv420p',
      '-r', String(PLAYLIST_FPS),
      '-g', String(PLAYLIST_FPS * 6),
      '-keyint_min', String(PLAYLIST_FPS * 6),
      ...(codecMode === 'avc1' ? ['-tag:v', 'avc1', '-profile:v', 'main', '-level', '4.0'] : []),
      '-crf', '26',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      '-avoid_negative_ts', 'make_zero',
      '-max_muxing_queue_size', '9999'
    );
  }

  private buildRemux(
    inputPath: string,
    outputPath: string,
    codecMode: NormalizeCodecMode,
    hasAudio: boolean
  ): string[] {
    if (!hasAudio) {
      const args = [
        '-y',
        ...BEFORE_INPUT,
        '-i',
        inputPath,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-map',
        '0:v:0',
        '-map',
        '1:a',
        '-shortest',
        '-c:v',
        'copy',
      ];
      if (codecMode === 'avc1') args.push('-tag:v', 'avc1');
      args.push(
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        outputPath
      );
      return args;
    }

    const args = ['-y', ...BEFORE_INPUT, '-i', inputPath, '-sn', '-dn', '-map', '0:v:0', '-map', '0:a:0'];
    args.push('-c', 'copy');
    if (codecMode === 'avc1') args.push('-tag:v', 'avc1');
    args.push('-movflags', '+faststart', outputPath);
    return args;
  }

  private buildTranscode(
    inputPath: string,
    outputPath: string,
    codecMode: NormalizeCodecMode,
    hasAudio: boolean
  ): string[] {
    if (hasAudio) {
      const args = ['-y', '-threads', '0', ...BEFORE_INPUT, '-i', inputPath, '-sn', '-dn', '-vf', this.vfStandard()];
      args.push('-map', '0:v:0', '-map', '0:a:0');
      this.appendOutCodecs(args, codecMode);
      args.push(outputPath);
      return args;
    }

    const args = [
      '-y',
      '-threads',
      '0',
      ...BEFORE_INPUT,
      '-i',
      inputPath,
      '-sn',
      '-dn',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-vf',
      this.vfStandard(),
      '-map',
      '0:v:0',
      '-map',
      '1:a',
      '-shortest',
    ];
    this.appendOutCodecs(args, codecMode);
    args.push(outputPath);
    return args;
  }

  private buildUnifiedBrand(
    inputPath: string,
    outputPath: string,
    brand: LogoBurnConfig,
    codecMode: NormalizeCodecMode
  ): string[] {
    const logoPath = overlayService.resolveImagePath(brand);
    const args = ['-y', '-threads', '0', ...BEFORE_INPUT, '-i', inputPath];
    args.push('-loop', '1', '-framerate', String(PLAYLIST_FPS), '-i', logoPath);
    args.push(
      '-filter_complex',
      overlayService.buildLogoBurnFilterComplex(brand, OUT_W, OUT_H, false, true, false)
    );
    args.push('-map', '[vout]', '-map', '0:a:0?');
    this.appendOutCodecs(args, codecMode);
    args.push('-shortest', outputPath);
    return args;
  }

  private buildAttemptList(
    inputPath: string,
    outputPath: string,
    probe: VideoProbe | null,
    brand: LogoBurnConfig | null,
    codecMode: NormalizeCodecMode
  ): { attempts: string[][]; mode: string } {
    if (brand?.enabled && overlayService.resolveImagePath(brand)) {
      return {
        mode: 'transcode_brand',
        attempts: [this.buildUnifiedBrand(inputPath, outputPath, brand, codecMode)],
      };
    }
    if (probe && this.isRemuxCompatible(probe)) {
      return {
        mode: 'remux',
        attempts: [
          this.buildRemux(inputPath, outputPath, codecMode, !!probe?.audioCodec),
          this.buildTranscode(inputPath, outputPath, codecMode, !!probe?.audioCodec),
        ],
      };
    }
    return {
      mode: 'transcode',
      attempts: [this.buildTranscode(inputPath, outputPath, codecMode, !!probe?.audioCodec)],
    };
  }

  /** Enqueue unified ingest — single FFmpeg pass when possible. */
  enqueueIngest(options: IngestOptions): void {
    if (this.activeItems.has(options.itemId)) {
      logger.warn(`Ingest already active for ${options.itemId}`);
      return;
    }
    this.activeItems.add(options.itemId);
    void processingQueueService
      .enqueue(() => this.runIngest(options))
      .finally(() => this.activeItems.delete(options.itemId));
  }

  async runIngest(options: IngestOptions): Promise<void> {
    const {
      itemId,
      sourcePath,
      playlistId,
      codecMode = 'legacy',
      jobType = 'INGEST',
      skipBrand = false,
    } = options;

    const item = await prisma.playlistItem.findUnique({ where: { id: itemId } });
    if (!item) return;

    const resolved = this.resolveSourcePath({ ...item, sourceVideoPath: sourcePath }) || sourcePath;
    if (!fs.existsSync(resolved) || fs.statSync(resolved).size < 1024) {
      await this.failItem(itemId, playlistId, 'Source video missing or empty');
      return;
    }

    const outputPath = this.getNormalizedPath(itemId);
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }

    let brand: LogoBurnConfig | null = null;
    if (!skipBrand) {
      brand =
        options.brandConfig ??
        (await brandResolverService.resolveForItem(itemId));
    }

    const probe = await this.probeInput(resolved);
    const { attempts, mode } = this.buildAttemptList(resolved, outputPath, probe, brand, codecMode);

    const job = await prisma.processingJob.create({
      data: {
        type: jobType,
        status: 'QUEUED',
        playlistItemId: itemId,
        playlistId,
        sourcePath: resolved,
        outputPath,
        mode,
      },
    });

    await appLogService.log('UPLOAD', `Ingest queued (${mode}) for ${item.originalFilename}`, 'INFO', {
      itemId,
      jobId: job.id,
      mode,
    });

    await prisma.playlistItem.update({
      where: { id: itemId },
      data: { status: 'PROCESSING', processingError: null },
    });
    wsService.emitPlaylistItemStatus(itemId, playlistId, 'PROCESSING', `Ingest (${mode})…`);

    await prisma.processingJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });
    this.emitJob(job.id);

    let lastStderr = '';
    let success = false;

    for (let i = 0; i < attempts.length; i++) {
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
      }
      const result = await this.runFfmpegWithProgress(
        attempts[i],
        job.id,
        probe?.durationSec ?? item.duration ?? 0
      );
      lastStderr = result.stderr;
      if (result.code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
        success = true;
        break;
      }
      logger.warn(`Ingest attempt ${i + 1}/${attempts.length} failed for ${itemId}`);
    }

    if (success) {
      const duration = await this.probeDuration(outputPath);
      const hasBrand = !!(brand?.enabled && overlayService.resolveImagePath(brand));
      await prisma.playlistItem.update({
        where: { id: itemId },
        data: {
          videoPath: outputPath,
          sourceVideoPath: resolved,
          status: 'READY',
          duration,
          logoBurned: hasBrand,
          brandApplied: hasBrand,
          processingError: null,
          ...(brand && hasBrand ? { logoConfig: brand as object } : {}),
        },
      });
      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          progressPct: 100,
          finishedAt: new Date(),
        },
      });
      wsService.emitPlaylistItemStatus(itemId, playlistId, 'READY');
      await appLogService.log('FFMPEG', `Ingest completed (${mode})`, 'INFO', { itemId, jobId: job.id });
      const { playlistService } = require('./playlist.service');
      const item = await prisma.playlistItem.findUnique({
        where: { id: itemId },
        select: { originalFilename: true },
      });
      await playlistService.generateConcatFile(playlistId, false, true, {
        changeType: jobType === 'REBRAND' ? 'replace' : 'add',
        newMedia: item?.originalFilename,
        itemId,
      });
    } else {
      const errMsg = this.extractError(lastStderr);
      await prisma.processingJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: errMsg, finishedAt: new Date() },
      });
      await this.failItem(itemId, playlistId, errMsg);
      await appLogService.log('FFMPEG', `Ingest failed: ${errMsg}`, 'ERROR', { itemId, jobId: job.id });
    }
    this.emitJob(job.id);
  }

  private runFfmpegWithProgress(
    args: string[],
    jobId: string,
    totalDurationSec: number
  ): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      logger.info(`ingest: ${env.FFMPEG_PATH} ${args.join(' ')}`);
      const child: ChildProcess = spawn(env.FFMPEG_PATH, args);
      let stderr = '';
      let lastEmit = 0;

      void prisma.processingJob.update({
        where: { id: jobId },
        data: { ffmpegPid: child.pid ?? null },
      });

      child.stderr?.on('data', (d) => {
        const chunk = d.toString();
        stderr += chunk;
        const lines = chunk.split(/\r?\n/);
        for (const line of lines) {
          const stats = parseFfmpegProgress(line);
          if (!stats) continue;
          const now = Date.now();
          if (now - lastEmit < 800) continue;
          lastEmit = now;

          const timeSec = typeof stats.timeSec === 'number' ? stats.timeSec : 0;
          const speedStr = typeof stats.speed === 'string' ? stats.speed : '0x';
          const speedNum = parseFloat(speedStr) || 0;
          let etaSeconds: number | null = null;
          let progressPct = 0;
          if (totalDurationSec > 0 && timeSec > 0) {
            progressPct = Math.min(99, (timeSec / totalDurationSec) * 100);
            if (speedNum > 0) {
              etaSeconds = Math.round((totalDurationSec - timeSec) / speedNum);
            }
          }

          void prisma.processingJob
            .update({
              where: { id: jobId },
              data: {
                currentFrame: typeof stats.frames === 'number' ? stats.frames : 0,
                currentTimeSec: timeSec,
                encodingSpeed: speedStr,
                progressPct,
                etaSeconds,
              },
            })
            .then(() => this.emitJob(jobId))
            .catch(() => {});
        }
      });

      child.on('close', (code) => resolve({ code, stderr }));
      child.on('error', (err) => resolve({ code: 1, stderr: err.message }));
    });
  }

  private async emitJob(jobId: string): Promise<void> {
    const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
    if (job) wsService.emitProcessingJob(job as unknown as Record<string, unknown>);
  }

  private extractError(stderr: string): string {
    const lines = stderr.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (/conversion failed|error while|invalid|could not|no such file|permission denied/i.test(line)) {
        return line.slice(0, 240);
      }
    }
    return 'Ingest encode failed — check source format (MKV/MP3 may need full transcode)';
  }

  private async failItem(itemId: string, playlistId: string, msg: string): Promise<void> {
    await prisma.playlistItem.update({
      where: { id: itemId },
      data: { status: 'FAILED', processingError: msg },
    });
    wsService.emitPlaylistItemStatus(itemId, playlistId, 'FAILED', msg);
  }

  private probeDuration(filePath: string): Promise<number | undefined> {
    return new Promise((resolve) => {
      const probe = spawn(this.ffprobePath(), [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      let output = '';
      probe.stdout.on('data', (d) => { output += d.toString(); });
      probe.on('close', (code) => {
        if (code === 0) {
          const dur = parseFloat(output.trim());
          resolve(isNaN(dur) ? undefined : dur);
        } else resolve(undefined);
      });
      probe.on('error', () => resolve(undefined));
    });
  }

  isProcessing(itemId: string): boolean {
    return this.activeItems.has(itemId);
  }

  private runFfmpegSimple(args: string[]): Promise<number | null> {
    return new Promise((resolve) => {
      const child = spawn(env.FFMPEG_PATH, args);
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(null));
    });
  }

  /** Add a stereo AAC track to normalized MP4s that were saved video-only. */
  async ensureNormalizedHasAudio(filePath: string): Promise<boolean> {
    const { probeMediaHasAudio, clearMediaDurationCache } = await import('./mediaProbe.service');
    if (!filePath || !fs.existsSync(filePath)) return false;
    if (await probeMediaHasAudio(filePath)) return true;

    const tmpPath = `${filePath}.audiofix.tmp.mp4`;
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...BEFORE_INPUT,
      '-i',
      filePath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-map',
      '0:v:0',
      '-map',
      '1:a',
      '-shortest',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      tmpPath,
    ];

    const code = await this.runFfmpegSimple(args);
    if (code !== 0 || !fs.existsSync(tmpPath) || fs.statSync(tmpPath).size < 1024) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      logger.warn(`[AUDIO_FIX] path=${filePath} failed code=${code ?? 'error'}`);
      return false;
    }

    const backupPath = `${filePath}.noaudio.bak`;
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      fs.renameSync(filePath, backupPath);
      fs.renameSync(tmpPath, filePath);
    } catch {
      try {
        fs.copyFileSync(tmpPath, filePath);
        fs.unlinkSync(tmpPath);
      } catch {
        return false;
      }
    }

    clearMediaDurationCache(filePath);
    logger.info(`[AUDIO_FIX] path=${filePath} action=added_aac_track`);
    return true;
  }

  async ensureConcatHasAudio(concatPath: string): Promise<number> {
    const { parseConcatMediaPaths, probeMediaHasAudio } = await import('./mediaProbe.service');
    const paths = [...new Set(parseConcatMediaPaths(concatPath))];
    let fixed = 0;
    for (const mediaPath of paths) {
      if (await probeMediaHasAudio(mediaPath)) continue;
      if (await this.ensureNormalizedHasAudio(mediaPath)) fixed++;
    }
    return fixed;
  }
}

export const ingestService = new IngestService();
