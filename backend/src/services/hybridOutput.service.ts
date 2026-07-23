import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { HybridNormalizationMode } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { monitorService } from './monitor.service';
import { wsService } from './websocket.service';
import {
  appendHybridHlsOutput,
  appendHybridLiveInputOptions,
  appendHybridStreamCopyHls,
  buildHybridTranscodeFilter,
  ensureHybridMasterPlaylist,
  getHybridNextSegmentNumber,
  getHybridPrewarmDir,
  getHybridVariant,
  HYBRID_STATION_GOP_FRAMES,
  HYBRID_STATION_LIST_SIZE,
  HYBRID_STATION_SEGMENT_SECONDS,
  mergePrewarmIntoMain,
  prepareHybridHandoff,
  prepareHybridLiveHandoff,
  prepareHybridSeamlessLiveHandoff,
  stripHybridEndList,
  trimPlaylistBeforeTransition,
  waitForHlsSegment,
  waitForPrewarmSegments,
} from '../utils/hybridHls';
import { matchesHybridTarget, probeStream } from './streamProbe.service';
import { ffmpegService } from './ffmpeg.service';

const IPTV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const KILL_GRACE_MS = 5000;

type HybridDecoderKind = 'live' | 'station';

export interface LiveFeedPlan {
  transcode: 'copy' | 'transcode';
  hasAudio: boolean;
}

interface StartLiveFeedOptions {
  /** seamless = append after station/blueprint; fresh = cold start (recovery); continue = prewarm merged */
  handoff?: 'seamless' | 'fresh' | 'continue';
  waitForReady?: boolean;
  prefetched?: LiveFeedPlan;
  startNumber?: number;
}

interface TransitionToLiveOptions {
  liveFeedUrl: string;
  normalization: HybridNormalizationMode;
  stationPath?: string | null;
  stationNormalization?: HybridNormalizationMode;
  prefetched?: LiveFeedPlan;
  onSpliced?: () => void;
}

interface TransitionToScheduleOptions {
  stationPath?: string | null;
  stationNormalization?: HybridNormalizationMode;
  onSpliced?: () => void;
}

interface PrewarmEntry {
  process: ChildProcess;
  prewarmDir: string;
}

interface HybridProcessEntry {
  process: ChildProcess;
  kind: HybridDecoderKind;
}

const PREWARM_MIN_SEGMENTS = 1;
const PREWARM_WAIT_MS = 8_000;
const HANDOFF_KEEP_SEGMENTS = 8;

class HybridOutputService {
  private processes = new Map<string, HybridProcessEntry>();
  private prewarmProcesses = new Map<string, PrewarmEntry>();
  private intentionalStop = new Set<string>();

  isRunning(channelId: string): boolean {
    return this.processes.has(channelId);
  }

  async stop(channelId: string): Promise<void> {
    await this.stopLivePrewarm(channelId);

    const entry = this.processes.get(channelId);
    if (!entry) return;

    this.intentionalStop.add(channelId);
    this.processes.delete(channelId);
    try {
      await this.gracefulKill(entry.process);
      await prisma.hybridChannelState.updateMany({
        where: { channelId },
        data: { decoderPid: null },
      });
    } finally {
      setTimeout(() => this.intentionalStop.delete(channelId), 8000);
    }
  }

  resolveMediaPath(videoPath: string): string {
    const trimmed = videoPath.trim();
    if (!trimmed) return trimmed;
    if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) return trimmed;

    const candidates = [
      trimmed,
      path.join(env.UPLOADS_DIR, trimmed),
      path.join(env.UPLOADS_DIR, trimmed.replace(/^uploads[\\/]/, '')),
      path.join('/var/uploads', trimmed.replace(/^uploads[\\/]/, '')),
      path.join('/var/uploads/normalized', path.basename(trimmed)),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return path.isAbsolute(trimmed) ? trimmed : path.join(env.UPLOADS_DIR, trimmed);
  }

  /** Play station-ID bumper once — always transcode to match channel output. */
  async playStationId(
    channel: { id: string; name: string; slug: string; transcodingProfile?: { resolution?: string | null } | null },
    videoPath: string,
    _normalization: HybridNormalizationMode
  ): Promise<number> {
    const resolved = this.resolveMediaPath(videoPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Station ID video not found: ${videoPath} (resolved: ${resolved})`);
    }

    const { variant, width, height } = getHybridVariant(channel.transcodingProfile?.resolution);
    const outDir = path.join(env.STREAMS_DIR, channel.slug);
    const variantDir = path.join(outDir, variant);
    const startNumber = prepareHybridHandoff(outDir, variant);
    ensureHybridMasterPlaylist(outDir, variant);

    const probe = await probeStream(resolved);
    const hasSourceAudio = probe.hasAudio;

    const args: string[] = ['-hide_banner', '-loglevel', 'warning', '-re', '-i', resolved];

    if (hasSourceAudio) {
      const maps = buildHybridTranscodeFilter(width, height, 24);
      args.push('-filter_complex', maps.filter);
      appendHybridHlsOutput(args, outDir, variant, maps.videoOut, true, startNumber, 'station');
    } else {
      args.push(
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-shortest'
      );
      const maps = buildHybridTranscodeFilter(width, height, 24);
      args.push('-filter_complex', maps.filter);
      args.push('-map', maps.videoOut, '-map', '1:a');
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-b:v',
        '2800k',
        '-maxrate',
        '3200k',
        '-bufsize',
        '8400k',
        '-g',
        String(HYBRID_STATION_GOP_FRAMES),
        '-keyint_min',
        String(HYBRID_STATION_GOP_FRAMES),
        '-sc_threshold',
        '0',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2'
      );
      if (startNumber > 0) {
        args.push('-start_number', String(startNumber));
      }
      args.push(
        '-max_muxing_queue_size',
        '2048',
        '-f',
        'hls',
        '-hls_time',
        String(HYBRID_STATION_SEGMENT_SECONDS),
        '-hls_list_size',
        String(HYBRID_STATION_LIST_SIZE),
        '-hls_playlist_type',
        'event',
        '-hls_flags',
        'append_list+independent_segments+program_date_time+delete_segments+temp_file+discont_start',
        '-hls_delete_threshold',
        '4',
        '-master_pl_name',
        'master.m3u8',
        '-var_stream_map',
        'v:0,a:0',
        '-hls_segment_filename',
        path.join(variantDir, 'segment_%05d.ts'),
        path.join(variantDir, 'index.m3u8')
      );
    }

    monitorService.addLog(channel.id, 'INFO', `Hybrid: playing station ID — ${path.basename(resolved)}`);
    logger.info(`[HYBRID] channel=${channel.slug} station-id transcode path=${resolved} start=${startNumber}`);

    await this.runUntilExit(channel.id, 'station', args);
    stripHybridEndList(outDir, variant);
    return startNumber;
  }

  /**
   * TV-style go-live: pre-buffer live while blueprint keeps playing, then instant splice.
   * Optional station ID only when configured and saved.
   */
  async transitionToLive(
    channel: { id: string; name: string; slug: string; transcodingProfile?: { resolution?: string | null } | null },
    options: TransitionToLiveOptions
  ): Promise<void> {
    const url = options.liveFeedUrl.trim();
    if (!url) throw new Error('Live feed URL is required');

    const plan = options.prefetched ?? (await this.prepareLiveFeed(url, options.normalization));
    const { variant } = getHybridVariant(channel.transcodingProfile?.resolution);
    const outDir = path.join(env.STREAMS_DIR, channel.slug);
    ensureHybridMasterPlaylist(outDir, variant);

    const prewarmPromise = this.startLivePrewarm(
      channel,
      url,
      options.normalization,
      plan,
      variant
    );

    const prewarmDir = getHybridPrewarmDir(outDir, variant);
    await waitForPrewarmSegments(prewarmDir, PREWARM_MIN_SEGMENTS, PREWARM_WAIT_MS).catch(
      async () => {
        await prewarmPromise.catch(() => undefined);
        logger.warn(`[HYBRID] live prewarm thin channel=${channel.slug} — switching with buffer`);
      }
    );

    if (options.stationPath) {
      await ffmpegService.stopDecoderOnly(channel.id, { preserveBlueprintRuntime: true });
      await this.stop(channel.id);
      prepareHybridHandoff(outDir, variant);
      try {
        await this.playStationId(
          channel,
          options.stationPath,
          options.stationNormalization ?? options.normalization
        );
        stripHybridEndList(outDir, variant);
      } catch (stationErr) {
        const msg = stationErr instanceof Error ? stationErr.message : String(stationErr);
        logger.warn(`[HYBRID] station-id skipped channel=${channel.slug}: ${msg}`);
        monitorService.addLog(channel.id, 'WARN', `Station ID skipped: ${msg}`);
      }
    } else {
      await ffmpegService.stopDecoderOnly(channel.id, { preserveBlueprintRuntime: true });
      await this.stop(channel.id);
    }

    await prewarmPromise.catch((err) =>
      logger.warn(`[HYBRID] prewarm failed channel=${channel.slug}:`, err)
    );
    await this.stopLivePrewarm(channel.id);

    const { nextStartNumber, mergedLiveCount } = mergePrewarmIntoMain(outDir, variant, {
      keepStationSegments: options.stationPath ? 0 : HANDOFF_KEEP_SEGMENTS,
    });

    await this.startLiveFeed(channel, url, options.normalization, {
      handoff: mergedLiveCount > 0 ? 'continue' : 'seamless',
      waitForReady: false,
      prefetched: plan,
      startNumber: nextStartNumber,
    });
    options.onSpliced?.();
  }

  /**
   * TV-style return: pre-buffer blueprint while live keeps playing, then instant splice.
   */
  async transitionToSchedule(
    channel: { id: string; name: string; slug: string; useBlueprint?: boolean; transcodingProfile?: { resolution?: string | null } | null },
    options: TransitionToScheduleOptions
  ): Promise<void> {
    const full = await prisma.channel.findUnique({
      where: { id: channel.id },
      include: { transcodingProfile: true, overlays: true, playlist: true, blueprint: true },
    });
    if (!full) throw new Error('Channel not found');

    const { variant } = getHybridVariant(channel.transcodingProfile?.resolution);
    const outDir = path.join(env.STREAMS_DIR, channel.slug);
    ensureHybridMasterPlaylist(outDir, variant);

    const prewarmPromise = ffmpegService.startBlueprintPrewarm(full);
    const prewarmDir = getHybridPrewarmDir(outDir, variant);

    await waitForPrewarmSegments(prewarmDir, PREWARM_MIN_SEGMENTS, PREWARM_WAIT_MS).catch(
      async () => {
        await prewarmPromise.catch(() => undefined);
        logger.warn(`[HYBRID] blueprint prewarm thin channel=${channel.slug} — switching with buffer`);
      }
    );

    if (options.stationPath) {
      await this.stop(channel.id);
      prepareHybridHandoff(outDir, variant);
      try {
        await this.playStationId(
          channel,
          options.stationPath,
          options.stationNormalization ?? 'AUTO'
        );
        stripHybridEndList(outDir, variant);
      } catch (stationErr) {
        const msg = stationErr instanceof Error ? stationErr.message : String(stationErr);
        logger.warn(`[HYBRID] station-id skipped channel=${channel.slug}: ${msg}`);
        monitorService.addLog(channel.id, 'WARN', `Station ID skipped: ${msg}`);
      }
    } else {
      await this.stop(channel.id);
    }

    await prewarmPromise.catch((err) =>
      logger.warn(`[HYBRID] blueprint prewarm failed channel=${channel.slug}:`, err)
    );
    await ffmpegService.stopBlueprintPrewarm(channel.id);

    const { nextStartNumber, mergedLiveCount } = mergePrewarmIntoMain(outDir, variant, {
      keepStationSegments: options.stationPath ? 0 : HANDOFF_KEEP_SEGMENTS,
    });

    ffmpegService.clearReconnectState(channel.id);
    await ffmpegService.startStream(full, {
      force: true,
      hybridHandoff: true,
      continueAppend: mergedLiveCount > 0,
      startNumber: nextStartNumber,
      waitForReady: false,
    });
    options.onSpliced?.();
  }

  private async startLivePrewarm(
    channel: { id: string; name: string; slug: string; transcodingProfile?: { resolution?: string | null } | null },
    liveFeedUrl: string,
    normalization: HybridNormalizationMode,
    plan: LiveFeedPlan,
    variant: string
  ): Promise<void> {
    await this.stopLivePrewarm(channel.id);

    const url = liveFeedUrl.trim();
    const outDir = path.join(env.STREAMS_DIR, channel.slug);
    const prewarmDir = getHybridPrewarmDir(outDir, variant);
    const { width, height } = getHybridVariant(channel.transcodingProfile?.resolution);

    if (fs.existsSync(prewarmDir)) {
      fs.rmSync(prewarmDir, { recursive: true, force: true });
    }
    fs.mkdirSync(prewarmDir, { recursive: true });

    const args: string[] = ['-hide_banner', '-loglevel', 'warning'];
    args.push(
      '-thread_queue_size',
      '4096',
      '-user_agent',
      IPTV_UA,
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5'
    );
    appendHybridLiveInputOptions(args);
    args.push('-i', url);

    const prewarmOut = path.join(outDir, '.hybrid-prewarm');
    if (plan.transcode === 'transcode') {
      const maps = buildHybridTranscodeFilter(width, height, 24);
      args.push('-filter_complex', maps.filter);
      appendHybridHlsOutput(args, prewarmOut, variant, maps.videoOut, plan.hasAudio, 1, 'live');
    } else {
      appendHybridStreamCopyHls(args, prewarmOut, variant, plan.hasAudio, 1, 'live');
    }

    logger.info(`[HYBRID] channel=${channel.slug} prewarming live feed url=${url}`);

    const proc = spawn(env.FFMPEG_PATH, args);
    this.prewarmProcesses.set(channel.id, { process: proc, prewarmDir });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Prewarm ffmpeg failed to start')), 15_000);
      proc.once('spawn', () => {
        clearTimeout(timer);
        resolve();
      });
      proc.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async stopLivePrewarm(channelId: string): Promise<void> {
    const entry = this.prewarmProcesses.get(channelId);
    if (!entry) return;

    this.prewarmProcesses.delete(channelId);
    await this.gracefulKill(entry.process);
  }

  /** Pre-probe live URL while station ID plays — cuts dead air before OBS handoff. */
  async prepareLiveFeed(
    liveFeedUrl: string,
    normalization: HybridNormalizationMode
  ): Promise<LiveFeedPlan> {
    const url = liveFeedUrl.trim();
    const transcode = await this.shouldTranscode(url, normalization, false);
    const probe = await probeStream(url);
    return { transcode, hasAudio: probe.hasAudio || probe.online };
  }

  /** Pull external HLS live feed into the permanent viewer output directory. */
  async startLiveFeed(
    channel: { id: string; name: string; slug: string; transcodingProfile?: { resolution?: string | null } | null },
    liveFeedUrl: string,
    normalization: HybridNormalizationMode,
    options?: StartLiveFeedOptions
  ): Promise<void> {
    await this.stop(channel.id);

    const url = liveFeedUrl.trim();
    if (!url) throw new Error('Live feed URL is required');

    const { variant, width, height } = getHybridVariant(channel.transcodingProfile?.resolution);
    const outDir = path.join(env.STREAMS_DIR, channel.slug);
    const variantDir = path.join(outDir, variant);
    const handoff = options?.handoff ?? 'fresh';
    let startNumber = options?.startNumber;
    if (startNumber == null) {
      startNumber =
        handoff === 'continue'
          ? getHybridNextSegmentNumber(outDir, variant)
          : handoff === 'seamless'
            ? prepareHybridSeamlessLiveHandoff(outDir, variant, 1)
            : prepareHybridLiveHandoff(outDir, variant);
    }
    ensureHybridMasterPlaylist(outDir, variant);

    const plan =
      options?.prefetched ??
      (await this.prepareLiveFeed(url, normalization));
    const { transcode, hasAudio } = plan;
    const continueAppend = handoff === 'continue';

    const args: string[] = ['-hide_banner', '-loglevel', 'warning'];
    args.push(
      '-thread_queue_size',
      '4096',
      '-user_agent',
      IPTV_UA,
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5'
    );
    appendHybridLiveInputOptions(args);
    args.push('-i', url);

    if (transcode === 'transcode') {
      const maps = buildHybridTranscodeFilter(width, height, 24);
      args.push('-filter_complex', maps.filter);
      appendHybridHlsOutput(
        args,
        outDir,
        variant,
        maps.videoOut,
        hasAudio,
        startNumber,
        'live',
        continueAppend
      );
    } else {
      appendHybridStreamCopyHls(args, outDir, variant, hasAudio, startNumber, 'live', continueAppend);
    }

    monitorService.addLog(channel.id, 'INFO', `Hybrid: live feed active (${transcode}) — ${url}`);
    logger.info(`[HYBRID] channel=${channel.slug} live-feed ${transcode} url=${url} start=${startNumber}`);

    const proc = spawn(env.FFMPEG_PATH, args);
    this.processes.set(channel.id, { process: proc, kind: 'live' });

    await prisma.hybridChannelState.update({
      where: { channelId: channel.id },
      data: { decoderPid: proc.pid ?? null },
    });
    await prisma.channel.update({
      where: { id: channel.id },
      data: { pid: proc.pid ?? null, status: 'ONLINE' },
    });
    wsService.emitChannelStatus(channel.id, 'ONLINE');

    if (options?.waitForReady) {
      await waitForHlsSegment(variantDir, startNumber, 45_000);
      wsService.emitHybridState(channel.id, { streamReady: true, activeSource: 'LIVE' });
    } else {
      void waitForHlsSegment(variantDir, startNumber)
        .then(() => {
          wsService.emitHybridState(channel.id, { streamReady: true, activeSource: 'LIVE' });
        })
        .catch(() => undefined);
    }

    proc.on('close', async (code) => {
      const intentional = this.intentionalStop.has(channel.id) || !this.processes.has(channel.id);
      this.processes.delete(channel.id);

      if (intentional) return;

      logger.warn(`[HYBRID] live feed exited channel=${channel.slug} code=${code}`);
      monitorService.addLog(channel.id, 'WARN', `Hybrid live feed exited (code ${code ?? 'null'})`);

      const state = await prisma.hybridChannelState.findUnique({ where: { channelId: channel.id } });
      if (state?.activeSource === 'LIVE' && state.liveFeedUrl) {
        setTimeout(() => {
          void this.startLiveFeed(channel, state.liveFeedUrl!, state.liveNormalization).catch((err) =>
            logger.error(`[HYBRID] live feed recovery failed channel=${channel.slug}:`, err)
          );
        }, 3000);
      }
    });

    proc.on('error', (err) => {
      logger.error(`[HYBRID] live feed error channel=${channel.slug}:`, err);
      monitorService.addLog(channel.id, 'ERROR', `Hybrid live feed error: ${err.message}`);
    });
  }

  private async shouldTranscode(
    input: string,
    mode: HybridNormalizationMode,
    isLocalFile: boolean
  ): Promise<'copy' | 'transcode'> {
    if (mode === 'ON') return 'transcode';
    if (mode === 'OFF') return 'copy';

    const probe = await probeStream(input, isLocalFile ? 6000 : 10000);
    if (!probe.online) return 'transcode';
    return matchesHybridTarget(probe) ? 'copy' : 'transcode';
  }

  private runUntilExit(channelId: string, kind: HybridDecoderKind, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(env.FFMPEG_PATH, args);
      this.processes.set(channelId, { process: proc, kind });

      let stderr = '';
      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      void prisma.hybridChannelState.update({
        where: { channelId },
        data: { decoderPid: proc.pid ?? null },
      });

      proc.on('close', (code) => {
        this.processes.delete(channelId);
        if (this.intentionalStop.has(channelId)) {
          resolve();
          return;
        }
        if (code === 0 || code === 255 || code === null) {
          resolve();
          return;
        }
        logger.warn(`[HYBRID] ${kind} ffmpeg exit code=${code} stderr=${stderr.slice(-500)}`);
        reject(new Error(`${kind} FFmpeg exited with code ${code}`));
      });

      proc.on('error', (err) => {
        this.processes.delete(channelId);
        reject(err);
      });
    });
  }

  private gracefulKill(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (!proc.pid) {
        resolve();
        return;
      }

      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      proc.once('close', done);
      proc.kill('SIGTERM');

      setTimeout(() => {
        if (!resolved) {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* already dead */
          }
          setTimeout(done, 300);
        }
      }, KILL_GRACE_MS);
    });
  }
}

export const hybridOutputService = new HybridOutputService();
