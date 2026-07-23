import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { FfmpegProcessInfo, StreamStats } from '../types';
import { parseFfmpegProgress, sleep } from '../utils/helpers';
import { wsService } from './websocket.service';
import { overlayService } from './overlay.service';
import { transcodingService } from './transcoding.service';
import { monitorService } from './monitor.service';
import { playlistService } from './playlist.service';
import { gpuEncoderService } from './gpuEncoder.service';

const FREEZE_TIMEOUT_MS = 30_000;
const RTMP_FREEZE_TIMEOUT_MS = 120_000;
const WATCHDOG_INTERVAL_MS = 10_000;
const ONLINE_CONFIRM_MS = 8_000;
const ONLINE_CONFIRM_RETRIES = 6;
const ONLINE_CONFIRM_RETRY_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;
const KILL_GRACE_MS = 5_000;

/** HLS tuning — longer segments + deeper playlist = fewer VLC micro-stalls */
const HLS_SEGMENT_SECONDS = 6;
const HLS_PLAYLIST_MIN_SEGMENTS = 60;
const HLS_GOP_FRAMES = 144; // 24fps × 6s, keyframes aligned to segment boundaries

class FfmpegService {
  private processes: Map<string, FfmpegProcessInfo> = new Map();
  private blueprintPrewarmProcesses = new Map<string, ChildProcess>();
  private reconnectAttempts: Map<string, number> = new Map();
  private watchdogTimer: NodeJS.Timeout | null = null;

  // ─── Watchdog ─────────────────────────────────────────────

  public startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => this.runWatchdog(), WATCHDOG_INTERVAL_MS);
    logger.info('FFmpeg process watchdog started');
  }

  public stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async runWatchdog(): Promise<void> {
    for (const [channelId, info] of this.processes.entries()) {
      const now = Date.now();

      // 1) Check if the OS process is still alive
      if (!this.isProcessAlive(info.process)) {
        logger.error(`Watchdog: FFmpeg PID ${info.pid} for channel ${channelId} is dead (zombie/orphan). Cleaning up.`);
        monitorService.addLog(channelId, 'ERROR', 'Watchdog detected dead FFmpeg process. Recovering...');
        this.processes.delete(channelId);
        if (info.playbackSource === 'MCR_SWITCHER') {
          void import('./mcr/mcrProgramEncoder.service').then(({ mcrProgramEncoderService }) =>
            mcrProgramEncoderService.scheduleRecovery(channelId)
          );
        } else {
          await this.triggerReconnect(channelId);
        }
        continue;
      }

      // 2) Freeze detection (playlist channels skip — CPU/concat can pause stderr briefly)
      const inputType = String(info.inputType || '').toUpperCase();
      if (inputType !== 'PLAYLIST') {
        const freezeTimeout =
          inputType === 'RTMP' ? RTMP_FREEZE_TIMEOUT_MS : FREEZE_TIMEOUT_MS;
        if (info.markedOnline && info.lastProgressTime > 0 && (now - info.lastProgressTime) > freezeTimeout) {
          logger.error(`Watchdog: Stream frozen for channel ${channelId} (no progress for ${Math.round((now - info.lastProgressTime) / 1000)}s). Killing.`);
          monitorService.addLog(channelId, 'ERROR', 'Watchdog detected frozen stream. Restarting...');
          await this.forceKill(channelId);
          continue;
        }
      }
    }
  }

  private isProcessAlive(proc: ChildProcess): boolean {
    if (!proc.pid) return false;
    try {
      process.kill(proc.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Stream start / stop ──────────────────────────────────

  public async startStream(
    channel: any,
    options?: {
      force?: boolean;
      hybridHandoff?: boolean;
      continueAppend?: boolean;
      startNumber?: number;
      waitForReady?: boolean;
    }
  ): Promise<void> {
    try {
      if (this.processes.has(channel.id)) {
        if (!options?.force) {
          logger.warn(`Stream for channel ${channel.name} is already running.`);
          return;
        }
        await this.stopStream(channel.id);
        await this.killChannelPid(channel.id);
        await sleep(1000);
      }

      this.ensureOutputDir(channel.slug);

      const { sourceRouterService } = await import('./sourceRouter.service');
      const isMcrBus =
        (await sourceRouterService.isMcrEnabledChannel(channel.id)) ||
        sourceRouterService.isMcrBusChannel(channel.id, channel.sourceUrl);

      if (isMcrBus) {
        const useV2Switcher = env.MCR_ARCHITECTURE === 'v2-switcher';

        if (useV2Switcher) {
          await sourceRouterService.migrateMcrChannelSourceUrl(channel.id);
          const { mcrSwitcherEngineService } = await import('./mcr/mcrSwitcherEngine.service');
          const router = await prisma.mcrRouterState.findUnique({
            where: { channelId: channel.id },
            select: { programSourceId: true },
          });
          await mcrSwitcherEngineService.ensurePermanentOutput(
            channel.id,
            router?.programSourceId
          );
          const { monitorService: mon } = await import('./monitor.service');
          mon.addLog(
            channel.id,
            'INFO',
            'MCR v2 switcher encoder active — source switches are instant (no bus relay)'
          );
          logger.info(
            `[MCR_OUTPUT_SOURCE] channelId=${channel.id} architecture=v2-switcher ` +
              `encoderRestart=false output=/stream/${channel.slug}/master.m3u8`
          );
          return;
        }

        const { mcrRelayService } = await import('./mcrRelay.service');
        channel = { ...channel, sourceUrl: mcrRelayService.getBusRtmpUrl(channel.id) };
        const bus = await sourceRouterService.ensureProgramBus(channel.id);
        const { monitorService } = await import('./monitor.service');
        monitorService.addLog(
          channel.id,
          'INFO',
          bus.mode === 'relay'
            ? `MCR bus ready — relaying ${bus.sourceLabel ?? 'automation source'}`
            : 'MCR bus ready — standby slate (route a source in Control Room)'
        );
        const playable = await sourceRouterService.waitForBusPlayable(channel.id, 30000);
        if (!playable) {
          throw new Error(
            `MCR bus not readable at ${channel.sourceUrl} — no RTMP publisher on nginx-rtmp`
          );
        }
        logger.info(
          `[MCR_OUTPUT_SOURCE] channelId=${channel.id} busPlayable=true encoderInput=${channel.sourceUrl}`
        );
        const { mcrIngestService } = await import('./mcrIngest.service');
        const busKey = mcrRelayService.getBusStreamKey(channel.id);
        const busHasMedia = await mcrIngestService.isStreamPublishingWithMedia(busKey);
        if (!busHasMedia) {
          logger.warn(
            `[MCR_ENCODER_BLOCKED] channelId=${channel.id} reason=bus_has_no_media busKey=${busKey}`
          );
          throw new Error(
            `Program encoder blocked: bus stream ${busKey} has no media (bitrate=0, ffprobe failed)`
          );
        }
        const { mcrBusDebugAuditService } = await import('./mcrBusDebugAudit.service');
        await mcrBusDebugAuditService.runPathAudit(channel.id, channel.sourceUrl);
        await this.startMcrBusStream(channel);
        return;
      }

      if (channel.isPlaylistChannel && (channel.playlistId || channel.useBlueprint || channel.blueprintId)) {
        await this.startPlaylistStream(channel, options);
      } else {
        await this.startDirectStream(channel);
      }
    } catch (error: any) {
      logger.error(`Error starting stream for channel ${channel.id}:`, error);
      monitorService.addLog(channel.id, 'ERROR', `Start failed: ${error.message}`);
      await prisma.channel.update({ where: { id: channel.id }, data: { status: 'ERROR' } });
      wsService.emitChannelStatus(channel.id, 'ERROR');
      const isMcrV2 =
        env.MCR_ARCHITECTURE === 'v2-switcher' &&
        (await import('./sourceRouter.service').then(({ sourceRouterService }) =>
          sourceRouterService.isMcrEnabledChannel(channel.id)
        ));
      if (!isMcrV2) {
        await this.triggerReconnect(channel.id);
      } else {
        const { mcrProgramEncoderService } = await import('./mcr/mcrProgramEncoder.service');
        mcrProgramEncoderService.scheduleRecovery(channel.id, 10000);
      }
    }
  }

  public async stopStream(channelId: string, options?: { preserveBlueprintRuntime?: boolean }): Promise<void> {
    const processInfo = this.processes.get(channelId);
    if (processInfo) {
      logger.info(`Stopping stream for channel ${channelId}`);

      if (processInfo.playbackSource === 'MCR_SWITCHER') {
        this.processes.delete(channelId);
        this.reconnectAttempts.delete(channelId);
        const { mcrProgramEncoderService } = await import('./mcr/mcrProgramEncoder.service');
        await mcrProgramEncoderService.stop(channelId, 'stopStream');
        await prisma.channel.update({
          where: { id: channelId },
          data: { status: 'OFFLINE', pid: null },
        });
        wsService.emitChannelStatus(channelId, 'OFFLINE');
        return;
      }

      this.processes.delete(channelId);
      this.reconnectAttempts.delete(channelId);
      if (processInfo.playbackSource === 'BLUEPRINT') {
        const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
        const { pipelineForensicsService } = await import('./pipelineForensics.service');
        const rt = blueprintPlaybackService.getRuntime(channelId);
        const persisted = blueprintPlaybackService.loadPersistedState(channelId);
        pipelineForensicsService.captureBeforeRestart(channelId, rt ?? null, persisted?.windowsEmitted);
        if (!options?.preserveBlueprintRuntime) {
          blueprintPlaybackService.clearRuntime(channelId);
        }
      }
      await this.gracefulKillProcess(processInfo.process);
    }

    await this.killChannelPid(channelId);
    await prisma.channel.update({
      where: { id: channelId },
      data: { status: 'OFFLINE', pid: null },
    });
    wsService.emitChannelStatus(channelId, 'OFFLINE');
  }

  /** Stop the active decoder without marking the channel offline (hybrid source handoff). */
  public async stopDecoderOnly(
    channelId: string,
    options?: { preserveBlueprintRuntime?: boolean }
  ): Promise<void> {
    const processInfo = this.processes.get(channelId);
    if (!processInfo) return;

    logger.info(`Stopping decoder only for channel ${channelId} (hybrid handoff)`);
    this.processes.delete(channelId);

    if (processInfo.playbackSource === 'BLUEPRINT' && options?.preserveBlueprintRuntime) {
      /* keep blueprint cursor/runtime for return-to-schedule */
    } else if (processInfo.playbackSource === 'BLUEPRINT') {
      const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
      blueprintPlaybackService.clearRuntime(channelId);
    }

    await this.gracefulKillProcess(processInfo.process);
    await prisma.channel.update({ where: { id: channelId }, data: { pid: null } });
  }

  public async restartStream(channelId: string, _legacyChannel?: any): Promise<void> {
    await this.stopStream(channelId);
    await this.killChannelPid(channelId);
    await sleep(2000);

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { transcodingProfile: true, overlays: true, playlist: true, blueprint: true },
    });
    if (!channel) return;

    await this.startStream(channel, { force: true });
  }

  /** Hard restart — used after blueprint publish so FFmpeg picks up the new concat. */
  public async forceRestartChannel(channelId: string): Promise<void> {
    await this.stopStream(channelId, { preserveBlueprintRuntime: true });
    await this.forceKill(channelId);
    await this.killChannelPid(channelId);
    await sleep(2500);

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { transcodingProfile: true, overlays: true, playlist: true, blueprint: true },
    });
    if (!channel) return;

    await prisma.channel.update({ where: { id: channelId }, data: { pid: null } });
    await this.startStream(channel, { force: true });
  }

  private async killChannelPid(channelId: string): Promise<void> {
    const row = await prisma.channel.findUnique({ where: { id: channelId }, select: { pid: true } });
    if (!row?.pid) return;
    try {
      process.kill(row.pid, 0);
      process.kill(row.pid, 'SIGKILL');
    } catch {
      /* already dead */
    }
  }

  /** Reload concat on all channels affected by a playlist change (playlist + blueprint block refs). */
  public async restartChannelsUsingPlaylist(playlistId: string): Promise<void> {
    const { blueprintPlaylistSyncService } = await import('./blueprintPlaylistSync.service');
    await blueprintPlaylistSyncService.handlePlaylistMutation({
      playlistId,
      changeType: 'other',
    });
  }

  // ─── Graceful kill with SIGKILL fallback ──────────────────

  private gracefulKillProcess(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (!proc.pid) { resolve(); return; }

      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      proc.once('close', done);
      proc.kill('SIGTERM');

      setTimeout(() => {
        if (!resolved) {
          try {
            logger.warn(`Force-killing stuck FFmpeg PID ${proc.pid}`);
            proc.kill('SIGKILL');
          } catch { /* already dead */ }
          setTimeout(done, 500);
        }
      }, KILL_GRACE_MS);
    });
  }

  private async forceKill(channelId: string): Promise<void> {
    const info = this.processes.get(channelId);
    if (!info) return;

    this.processes.delete(channelId);

    await this.gracefulKillProcess(info.process);
    await prisma.channel.update({ where: { id: channelId }, data: { pid: null } });
    await this.triggerReconnect(channelId);
  }

  // ─── Auto-reconnect with exponential backoff ──────────────

  private async triggerReconnect(channelId: string): Promise<void> {
    const { hybridChannelService } = await import('./hybridChannel.service');
    if (await hybridChannelService.isLiveOverride(channelId)) {
      const state = await prisma.hybridChannelState.findUnique({ where: { channelId } });
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: { transcodingProfile: true },
      });
      if (state?.liveFeedUrl && channel) {
        const { hybridOutputService } = await import('./hybridOutput.service');
        if (!hybridOutputService.isRunning(channelId)) {
          monitorService.addLog(channelId, 'WARN', 'Hybrid: reconnecting live feed...');
          await hybridOutputService.startLiveFeed(channel, state.liveFeedUrl, state.liveNormalization);
        }
        return;
      }
    }

    const { sourceRouterService } = await import('./sourceRouter.service');
    if (
      env.MCR_ARCHITECTURE === 'v2-switcher' &&
      (await sourceRouterService.isMcrEnabledChannel(channelId))
    ) {
      const { mcrProgramEncoderService } = await import('./mcr/mcrProgramEncoder.service');
      mcrProgramEncoderService.scheduleRecovery(channelId, 10000);
      return;
    }

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { transcodingProfile: true, overlays: true, playlist: true, blueprint: true },
    });
    if (!channel || !channel.autoReconnect) {
      await prisma.channel.update({ where: { id: channelId }, data: { status: 'OFFLINE' } });
      wsService.emitChannelStatus(channelId, 'OFFLINE');
      return;
    }

    const attempts = this.reconnectAttempts.get(channelId) || 0;
    if (attempts >= channel.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts (${channel.maxReconnectAttempts}) reached for ${channel.name}. Giving up.`);
      monitorService.addLog(channelId, 'ERROR', `Max reconnect attempts reached (${channel.maxReconnectAttempts}). Stream stopped.`);
      await prisma.channel.update({ where: { id: channelId }, data: { status: 'OFFLINE' } });
      wsService.emitChannelStatus(channelId, 'OFFLINE');
      this.reconnectAttempts.delete(channelId);
      return;
    }

    this.reconnectAttempts.set(channelId, attempts + 1);
    const delay = Math.min(channel.reconnectDelay * Math.pow(2, attempts), MAX_BACKOFF_MS);

    await prisma.channel.update({ where: { id: channelId }, data: { status: 'ERROR' } });
    wsService.emitChannelStatus(channelId, 'ERROR');
    monitorService.addLog(channelId, 'WARN', `Reconnecting (${attempts + 1}/${channel.maxReconnectAttempts}) in ${Math.round(delay / 1000)}s...`);

    setTimeout(async () => {
      try {
        // Always reload latest channel config so reconnect does not use stale source URL.
        const latest = await prisma.channel.findUnique({
          where: { id: channelId },
          include: { transcodingProfile: true, overlays: true, playlist: true, blueprint: true },
        });
        if (!latest) return;
        await this.startStream(latest);
      } catch (err) {
        logger.error(`Reconnect failed for channel ${channelId}:`, err);
      }
    }, delay);
  }

  // ─── Process lifecycle helpers ────────────────────────────

  private registerProcess(
    channel: any,
    proc: ChildProcess,
    playbackSource?: 'BLUEPRINT' | 'PLAYLIST' | 'MCR_BUS' | 'MCR_SWITCHER'
  ): FfmpegProcessInfo {
    const info: FfmpegProcessInfo = {
      pid: proc.pid as number,
      channelId: channel.id,
      process: proc,
      inputType: channel.isPlaylistChannel ? 'PLAYLIST' : String(channel.sourceType || ''),
      playbackSource,
      startTime: new Date(),
      stats: { cpu: 0, ram: 0, gpu: 0, bitrate: 0, fps: 0, uptime: 0, frames: 0, speed: '0x' },
      lastProgressTime: Date.now(),
      markedOnline: false,
      sourceUnreachable: false,
    };
    this.processes.set(channel.id, info);
    return info;
  }

  private attachProgressParser(channel: any, proc: ChildProcess, info: FfmpegProcessInfo): void {
    let lastStatEmit = Date.now();
    let lastLogSave = 0;
    let stderrBuffer = '';
    const recentLines: string[] = [];

    const onData = (data: Buffer) => {
      info.lastProgressTime = Date.now();
      stderrBuffer += data.toString();

      const lines = stderrBuffer.split(/\r\n|\r|\n/);
      stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        recentLines.push(trimmed);
        if (recentLines.length > 30) recentLines.shift();

        const stats = parseFfmpegProgress(trimmed);
        if (stats) {
          info.stats = {
            ...info.stats,
            ...stats,
            uptime: Math.floor((Date.now() - info.startTime.getTime()) / 1000),
          };
          if (info.playbackSource === 'BLUEPRINT') {
            import('./blueprintPlayback.service').then(({ blueprintPlaybackService }) => {
              const mediaTime = info.stats.timeSec;
              if (typeof mediaTime === 'number' && mediaTime >= 0) {
                blueprintPlaybackService.updatePlaybackPosition(channel.id, mediaTime);
              }
            }).catch(() => {});
          }
          if (Date.now() - lastStatEmit > 2000) {
            wsService.emitChannelStats(channel.id, info.stats);
            lastStatEmit = Date.now();
          }
          continue;
        }

        if (Date.now() - lastLogSave < 500) continue;
        lastLogSave = Date.now();

        const lower = trimmed.toLowerCase();
        const sourceUrl = String(channel.sourceUrl || '').toLowerCase();
        const isHttpLikeSource =
          channel.sourceType === 'HTTP' ||
          channel.sourceType === 'M3U8' ||
          sourceUrl.startsWith('http://') ||
          sourceUrl.startsWith('https://');

        if (isHttpLikeSource && (lower.includes('404 not found') || lower.includes('http error 404'))) {
          info.sourceUnreachable = true;
          monitorService.addLog(
            channel.id,
            'ERROR',
            'Source URL is not available (HTTP 404). Check the URL, channel ID, and source type (use M3U8 for .m3u8 links).'
          );
        } else if (isHttpLikeSource && (lower.includes('403 forbidden') || lower.includes('401 unauthorized'))) {
          info.sourceUnreachable = true;
          monitorService.addLog(
            channel.id,
            'ERROR',
            'Source rejected the connection (HTTP 403/401). The URL may be expired or blocked.'
          );
        } else if (
          (lower.includes('error') ||
            lower.includes('fatal') ||
            lower.includes('cannot') ||
            lower.includes('failed') ||
            lower.includes('could not') ||
            lower.includes('invalid data')) &&
          !trimmed.includes('[libx264 @') &&
          !lower.includes('weighted p-frames')
        ) {
          monitorService.addLog(channel.id, 'ERROR', trimmed.slice(0, 300));
        } else if (lower.includes('warning') || lower.includes('discarding') || lower.includes('dropping')) {
          monitorService.addLog(channel.id, 'WARN', trimmed.slice(0, 300));
        } else if (lower.includes('input #') || lower.includes('output #') || lower.includes('stream #') || lower.includes('duration:')) {
          monitorService.addLog(channel.id, 'DEBUG', trimmed.slice(0, 300));
        }
      }
    };

    if (proc.stderr) proc.stderr.on('data', onData);

    // If FFmpeg exits early, dump the last few stderr lines for diagnosis
    proc.on('close', (code, signal) => {
      if (!recentLines.length) return;
      const tail = recentLines.slice(-8).join(' | ').slice(0, 900);
      const isLibx264Summary = /\[libx264 @|kb\/s:|Weighted P-Frames/i.test(tail);
      const intentionalStop = signal === 'SIGTERM' || signal === 'SIGINT';
      if (intentionalStop && isLibx264Summary) return;
      if (code && code !== 0 && !isLibx264Summary) {
        monitorService.addLog(channel.id, 'ERROR', `FFmpeg tail: ${tail}`);
      }
    });
  }

  private scheduleOnlineConfirmation(channel: any, proc: ChildProcess, info: FfmpegProcessInfo): void {
    const startedAtMs = Date.now();
    const confirm = (remainingRetries: number) => {
      if (this.processes.get(channel.id)?.pid !== proc.pid) return;

      if (this.hasConfirmedMediaFlow(channel.slug, info, startedAtMs)) {
        info.markedOnline = true;
        this.reconnectAttempts.set(channel.id, 0);
        prisma.channel.update({ where: { id: channel.id }, data: { status: 'ONLINE' } }).catch(() => {});
        wsService.emitChannelStatus(channel.id, 'ONLINE');
        monitorService.addLog(channel.id, 'INFO', 'Stream is online.');
        return;
      }

      if (remainingRetries <= 0) {
        monitorService.addLog(channel.id, 'ERROR', 'No playable media detected after startup window. Restarting stream...');
        this.forceKill(channel.id).catch(() => {});
        return;
      }

      setTimeout(() => confirm(remainingRetries - 1), ONLINE_CONFIRM_RETRY_MS);
    };

    setTimeout(() => confirm(ONLINE_CONFIRM_RETRIES), ONLINE_CONFIRM_MS);
  }

  private hasConfirmedMediaFlow(slug: string, info: FfmpegProcessInfo, startedAtMs: number): boolean {
    if ((info.stats.frames || 0) > 0) return true;
    if ((info.stats.bitrate || 0) > 0) return true;

    // MCR program encoder copies bus RTMP → HLS; v2 switcher writes HLS directly.
    if (info.playbackSource === 'MCR_BUS' || info.playbackSource === 'MCR_SWITCHER') {
      const outDir = this.getHlsOutputPath(slug);
      if (this.findNewestSegment(outDir, startedAtMs)) return true;
    }

    // RTMP ingest must prove packet flow; old HLS files are not a valid signal.
    if (String(info.inputType || '').toUpperCase() === 'RTMP' && info.playbackSource !== 'MCR_BUS') {
      return false;
    }

    const outDir = this.getHlsOutputPath(slug);
    if (!fs.existsSync(outDir)) return false;

    const variantIndexes = ['720p', '480p'].map((v) => path.join(outDir, v, 'index.m3u8'));
    const masterPath = path.join(outDir, 'master.m3u8');
    const candidates = [masterPath, ...variantIndexes];

    const freshTs = this.findNewestSegment(outDir, startedAtMs);
    if (freshTs) return true;

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const stat = fs.statSync(candidate);
        if (stat.size <= 0) continue;
        if (stat.mtimeMs >= startedAtMs - 2000) return true;
      } catch {
        /* try next */
      }
    }

    return false;
  }

  private findNewestSegment(outDir: string, startedAtMs: number): string | null {
    let newestPath: string | null = null;
    let newestMtime = 0;

    const scan = (folder: string) => {
      if (!fs.existsSync(folder)) return;
      for (const name of fs.readdirSync(folder)) {
        if (!name.endsWith('.ts')) continue;
        const full = path.join(folder, name);
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime < startedAtMs - 2000) continue;
        if (!newestPath || mtime > newestMtime) {
          newestPath = full;
          newestMtime = mtime;
        }
      }
    };

    scan(outDir);
    for (const sub of ['720p', '480p', '1080p']) {
      scan(path.join(outDir, sub));
    }
    return newestPath;
  }

  // ─── Playlist stream ─────────────────────────────────────

  private async shouldUseBlueprintPlayback(channel: any): Promise<boolean> {
    if (channel.useBlueprint && channel.blueprintId) return true;
    if (channel.blueprintId && !channel.playlistId) {
      if (!channel.useBlueprint) {
        await prisma.channel.update({
          where: { id: channel.id },
          data: { useBlueprint: true },
        });
        channel.useBlueprint = true;
      }
      return true;
    }
    return false;
  }

  private async startPlaylistStream(
    channel: any,
    options?: {
      hybridHandoff?: boolean;
      continueAppend?: boolean;
      startNumber?: number;
      waitForReady?: boolean;
      outputDir?: string;
      prewarm?: boolean;
    }
  ): Promise<void> {
    const isLooping = channel.useBlueprint
      ? false
      : (channel.playlist?.isLooping ?? false);
    let concatPath: string;
    let playbackSource: 'BLUEPRINT' | 'PLAYLIST';

    if (await this.shouldUseBlueprintPlayback(channel)) {
      const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
      const { blueprintWindowAuditService } = await import('./blueprintWindowAudit.service');
      const refreshed = await blueprintPlaybackService.refreshChannelWindow(channel.id);
      if (!refreshed) {
        const msg =
          'Blueprint has no ready videos — open Blueprint, assign a playlist to every block, and ensure items are READY.';
        logger.warn(`${msg} (${channel.name})`);
        blueprintWindowAuditService.logChannelStartFailure(channel.id, msg);
        monitorService.addLog(channel.id, 'ERROR', msg);
        await prisma.channel.update({ where: { id: channel.id }, data: { status: 'ERROR' } });
        wsService.emitChannelStatus(channel.id, 'ERROR');
        return;
      }
      concatPath = refreshed;
      playbackSource = 'BLUEPRINT';

      const validation = blueprintWindowAuditService.validateBlueprintChannelStart(channel.id, concatPath);
      if (!validation.ok) {
        const msg = `Blueprint start validation failed: ${validation.reason}`;
        logger.warn(`${msg} (${channel.name})`);
        blueprintWindowAuditService.logChannelStartFailure(channel.id, validation.reason);
        monitorService.addLog(channel.id, 'ERROR', msg);
        await prisma.channel.update({ where: { id: channel.id }, data: { status: 'ERROR' } });
        wsService.emitChannelStatus(channel.id, 'ERROR');
        return;
      }
    } else if (channel.playlistId) {
      const playlistLooping = channel.playlist?.isLooping ?? false;
      await playlistService.generateConcatFile(channel.playlistId, playlistLooping, false);
      concatPath = playlistService.getConcatFilePath(channel.playlistId);
      playbackSource = 'PLAYLIST';
    } else {
      const msg = 'No playlist or blueprint configured for this channel.';
      monitorService.addLog(channel.id, 'ERROR', msg);
      await prisma.channel.update({ where: { id: channel.id }, data: { status: 'ERROR' } });
      wsService.emitChannelStatus(channel.id, 'ERROR');
      return;
    }

    if (!fs.existsSync(concatPath)) {
      const msg =
        playbackSource === 'BLUEPRINT'
          ? 'Blueprint has no ready videos — assign playlists with READY items.'
          : 'Playlist has no ready videos.';
      logger.warn(`${msg} (${channel.name})`);
      monitorService.addLog(channel.id, 'WARN', msg);
      await prisma.channel.update({ where: { id: channel.id }, data: { status: 'ERROR' } });
      wsService.emitChannelStatus(channel.id, 'ERROR');
      return;
    }

    const outDir = options?.outputDir ?? this.getHlsOutputPath(channel.slug);
    const { variant } = this.getPlaylistOutputDimensions(channel);
    const variantPlaylistPath = path.join(outDir, variant, 'index.m3u8');
    const masterPath = path.join(outDir, 'master.m3u8');
    if (!fs.existsSync(masterPath) && !options?.prewarm) {
      this.writePlaylistMasterPlaylist(outDir, variant);
    }

    let hlsStartNumber: number | undefined;
    let continueAppend = options?.continueAppend;
    if (options?.startNumber != null) {
      hlsStartNumber = options.startNumber;
    } else if (options?.hybridHandoff && !options?.prewarm) {
      const { prepareHybridHandoff } = await import('../utils/hybridHls');
      hlsStartNumber = prepareHybridHandoff(outDir, variant);
    } else if (
      playbackSource === 'BLUEPRINT' &&
      !options?.prewarm &&
      fs.existsSync(variantPlaylistPath)
    ) {
      const { prepareHybridHandoff, ensureHybridMasterPlaylist } = await import('../utils/hybridHls');
      hlsStartNumber = prepareHybridHandoff(outDir, variant);
      ensureHybridMasterPlaylist(outDir, variant);
      logger.info(
        `[BLUEPRINT_HLS_HANDOFF] channel=${channel.slug} variant=${variant} startNumber=${hlsStartNumber}`
      );
    } else if (options?.prewarm) {
      hlsStartNumber = 1;
    }

    const encoder = gpuEncoderService.resolveForChannel(channel);

    const args: string[] = [];
    gpuEncoderService.prependDeviceArgs(args, encoder);
    args.push(...this.getInputCustomArgs(channel));
    args.push(
      '-re',
      '-fflags', '+genpts+igndts+discardcorrupt',
      '-thread_queue_size', '2048',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath
    );

    const playlistOverlays = overlayService.getPlaylistStreamOverlays(channel.overlays || []);
    const overlayInputs = await overlayService.getOverlayInputs(playlistOverlays);
    args.push(...overlayInputs);

    const { ingestService } = await import('./ingest.service');
    const audioFixed = await ingestService.ensureConcatHasAudio(concatPath);
    if (audioFixed > 0) {
      logger.info(`[PLAYLIST_AUDIO] channel=${channel.slug} repaired=${audioFixed} video-only concat entries`);
      monitorService.addLog(
        channel.id,
        'INFO',
        `Repaired ${audioFixed} playlist file(s) missing audio — restart will include sound.`
      );
    }

    const { probeConcatHasAudio } = await import('./mediaProbe.service');
    const hasSourceAudio = await probeConcatHasAudio(concatPath);
    let audioMap = '0:a';
    if (!hasSourceAudio) {
      const silentInputIndex = 1 + Math.ceil(overlayInputs.length / 2);
      args.push(
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000'
      );
      audioMap = `${silentInputIndex}:a`;
      logger.info(
        `[PLAYLIST_AUDIO] channel=${channel.slug} source=anullsrc concat=${path.basename(concatPath)}`
      );
      monitorService.addLog(channel.id, 'INFO', 'Blueprint source has no audio — generating silent AAC track.');
    } else {
      logger.info(`[PLAYLIST_AUDIO] channel=${channel.slug} source=concat_audio map=${audioMap}`);
    }

    const filterComplex = await overlayService.buildFilterComplex(playlistOverlays);
    if (this.hasMissingImageOverlay({ ...channel, overlays: playlistOverlays }, filterComplex)) return;

    const playlistMaps = this.preparePlaylistVideoMap(filterComplex, channel, encoder.pixelFormat);
    args.push('-filter_complex', playlistMaps.filterComplex);

    this.appendPlaylistStreamOutputs(
      args,
      channel,
      outDir,
      playlistMaps.videoOut,
      audioMap,
      encoder,
      hlsStartNumber,
      {
        continueAppend,
        listSize: options?.prewarm ? 6 : undefined,
        eventPlaylist: options?.prewarm || playbackSource === 'BLUEPRINT',
      }
    );

    if (options?.prewarm) {
      const proc = spawn(env.FFMPEG_PATH, args);
      this.blueprintPrewarmProcesses.set(channel.id, proc);
      logger.info(`[HYBRID] blueprint prewarm started channel=${channel.slug}`);
      proc.on('close', () => {
        this.blueprintPrewarmProcesses.delete(channel.id);
      });
      return;
    }

    const sourceLabel =
      playbackSource === 'BLUEPRINT'
        ? `Blueprint${channel.blueprint?.name ? `: ${channel.blueprint.name}` : ''}`
        : 'Playlist';

    if (playbackSource === 'BLUEPRINT') {
      const { blueprintWindowAuditService } = await import('./blueprintWindowAudit.service');
      blueprintWindowAuditService.logChannelStart(
        channel.id,
        concatPath,
        `${env.FFMPEG_PATH} ${args.join(' ')}`
      );
    }

    logger.info(`Starting ${sourceLabel} FFmpeg (${encoder.codec}, concat, ${variant}) for ${channel.name}`);
    monitorService.addLog(channel.id, 'INFO', `Playback source: ${sourceLabel}`);
    monitorService.addLog(channel.id, 'INFO', `Video encoder: ${encoder.label} (${encoder.codec})`);

    const mainProcess = spawn(env.FFMPEG_PATH, args);
    const info = this.registerProcess(channel, mainProcess, playbackSource);

    if (playbackSource === 'BLUEPRINT') {
      const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
      const { pipelineForensicsService } = await import('./pipelineForensics.service');
      blueprintPlaybackService.markStreamStarted(channel.id, channel.slug);
      const rt = blueprintPlaybackService.getRuntime(channel.id);
      const persisted = blueprintPlaybackService.loadPersistedState(channel.id);
      pipelineForensicsService.logChannelRestart(channel.id, {
        firstSegmentTitle: rt?.segments[0]?.title ?? null,
        engineIndex: 0,
        windowsEmitted: persisted?.windowsEmitted,
      });
    }

    await prisma.channel.update({ where: { id: channel.id }, data: { status: 'STARTING', pid: mainProcess.pid } });
    wsService.emitChannelStatus(channel.id, 'STARTING');

    this.attachProgressParser(channel, mainProcess, info);
    this.scheduleOnlineConfirmation(channel, mainProcess, info);

    if (options?.waitForReady) {
      const { waitForHlsSegment } = await import('../utils/hybridHls');
      const variantDir = path.join(this.getHlsOutputPath(channel.slug), variant);
      await waitForHlsSegment(variantDir, hlsStartNumber ?? 1, 45_000).catch(() => undefined);
    }

    mainProcess.on('close', async (code) => {
      const wasIntentional = !this.processes.has(channel.id);
      this.processes.delete(channel.id);
      if (wasIntentional) return;

      logger.warn(`Playlist FFmpeg for ${channel.name} exited (code ${code}).`);
      monitorService.addLog(channel.id, 'WARN', `Playlist FFmpeg exited with code ${code}.`);
      if (playbackSource === 'BLUEPRINT' && code !== 0 && code !== null) {
        const { blueprintWindowAuditService } = await import('./blueprintWindowAudit.service');
        blueprintWindowAuditService.logChannelStartFailure(
          channel.id,
          'ffmpeg exited during blueprint playback',
          code
        );
      }
      if (!isLooping) {
        if (playbackSource === 'BLUEPRINT' && channel.autoReconnect) {
          const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
          const { pipelineForensicsService } = await import('./pipelineForensics.service');
          const { playbackAuditService } = await import('./playbackAudit.service');
          const prevRt = blueprintPlaybackService.getRuntime(channel.id);
          const prevPersisted = blueprintPlaybackService.loadPersistedState(channel.id);
          playbackAuditService.logRolloverState(channel.id, prevRt ?? null, prevPersisted);
          pipelineForensicsService.captureBeforeRestart(channel.id, prevRt ?? null, prevPersisted?.windowsEmitted);
          await blueprintPlaybackService.refreshChannelWindow(channel.id, { reason: 'window_roll' });
          blueprintPlaybackService.clearPendingPlaylistChanges(channel.id);
          blueprintPlaybackService.markWindowRolled(channel.id);
          const rt = blueprintPlaybackService.getRuntime(channel.id);
          const persisted = blueprintPlaybackService.loadPersistedState(channel.id);
          pipelineForensicsService.logChannelRestart(channel.id, {
            firstSegmentTitle: rt?.segments[0]?.title ?? null,
            windowsEmitted: persisted?.windowsEmitted,
          });
          monitorService.addLog(channel.id, 'INFO', 'Blueprint window advanced — loading next videos.');
          this.triggerReconnect(channel.id);
          return;
        }
        await prisma.channel.update({ where: { id: channel.id }, data: { status: 'OFFLINE' } });
        wsService.emitChannelStatus(channel.id, 'OFFLINE');
        return;
      }
      this.triggerReconnect(channel.id);
    });

    mainProcess.on('error', (err) => {
      logger.error(`FFmpeg error for ${channel.name}:`, err);
      monitorService.addLog(channel.id, 'ERROR', `FFmpeg error: ${err.message}`);
    });
  }

  private appendLiveInputOptions(args: string[], channel: any): void {
    const url = (channel.sourceUrl || '').toLowerCase();
    const isHlsUrl = url.includes('.m3u8');
    const iptvUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    // Larger input queue reduces short stalls/bursts from network jitter.
    args.push('-thread_queue_size', '4096');

    if (isHlsUrl && channel.sourceType === 'MPEGTS') {
      logger.warn(`Channel ${channel.name}: .m3u8 URL with MPEGTS type — treating as M3U8/HLS input`);
      monitorService.addLog(
        channel.id,
        'WARN',
        'Source URL is .m3u8 but type is MPEGTS. Use source type M3U8 for playlist URLs.'
      );
    }

    if (channel.sourceType === 'RTMP') {
      // RTMP ingest from nginx-rtmp should be opened in client mode.
      // Using -listen 1 turns ffmpeg into an RTMP server and breaks pulls from nginx-rtmp.
      args.push('-rw_timeout', '15000000');
      const isMcrBus = /\/live\/mcr-[0-9a-f-]+/i.test(String(channel.sourceUrl || ''));
      if (isMcrBus) {
        // Program encoder must survive relay handoff gaps on the same bus stream key.
        args.push(
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5'
        );
      }
      return;
    }

    if (channel.sourceType === 'MP4') {
      args.push('-stream_loop', '-1', '-re');
      return;
    }

    if (channel.sourceType === 'M3U8' || channel.sourceType === 'HTTP' || isHlsUrl) {
      args.push(
        '-user_agent', iptvUa,
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'
      );
      return;
    }

    if (channel.sourceType === 'MPEGTS') {
      args.push(
        '-user_agent', iptvUa,
        '-fflags', '+genpts+discardcorrupt',
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'
      );
      if (channel.sourceUrl.startsWith('udp://') || channel.sourceUrl.startsWith('rtp://')) {
        args.push('-f', 'mpegts', '-analyzeduration', '1000000', '-probesize', '1000000');
      }
      return;
    }

    if (channel.sourceType === 'SRT') {
      args.push('-fflags', '+genpts+discardcorrupt');
      return;
    }

    if (channel.sourceType === 'UDP') {
      args.push('-f', 'mpegts', '-fflags', '+genpts+discardcorrupt', '-analyzeduration', '1000000', '-probesize', '1000000');
    }
  }

  /** Custom args safe before inputs (strips output/encode flags we set in appendAdaptiveStreamOutputs). */
  private getInputCustomArgs(channel: any): string[] {
    const raw = (channel?.customFfmpegArgs || '').trim();
    if (!raw) return [];

    const blocked =
      /^(?:-f|-c(?::|$)|-codec|-vcodec|-acodec|-b:(?:v|a)|-maxrate|-bufsize|-preset|-crf|-g(?::|$)|-keyint|-sc_threshold|-tune|-profile|-pix_fmt|-vf|-af|-filter|-map|-hls_|-var_stream_map|-master_pl_name|-listen|-listen_timeout)/i;

    const parts = raw.split(/\s+/).filter(Boolean);
    const sanitized: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const token = parts[i];
      const lower = token.toLowerCase();

      if (lower === '-listen' || lower === '-listen_timeout') {
        const next = parts[i + 1];
        if (next && !next.startsWith('-')) i++;
        continue;
      }

      if (blocked.test(token)) {
        const next = parts[i + 1];
        if (next && !next.startsWith('-')) i++;
        continue;
      }

      sanitized.push(token);
    }

    return sanitized;
  }

  private appendDashOutputArgs(args: string[], channel: any, outputPath: string): void {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    const segs = channel.enableDvr
      ? Math.floor(((channel.dvrWindowMinutes || 1440) * 60) / 4)
      : 10;
    args.push(
      '-y',
      '-f', 'dash',
      '-seg_duration', '4',
      '-use_template', '1',
      '-use_timeline', '1',
      '-window_size', segs.toString(),
      '-extra_window_size', '5',
      '-dash_segment_type', 'auto',
      outputPath
    );
  }

  private hasMissingImageOverlay(channel: any, filterComplex: string | null): boolean {
    const wantsImage = (channel.overlays || []).some(
      (o: any) =>
        o.isActive && (o.type === 'LOGO' || o.type === 'WATERMARK')
    );
    if (!wantsImage || filterComplex) return false;

    const msg =
      'Logo/watermark overlay is enabled but the image file is missing on the server. Re-upload the image (Overlays → upload file, not server path).';
    logger.warn(`${channel.name}: ${msg}`);
    monitorService.addLog(channel.id, 'ERROR', msg);
    prisma.channel
      .update({ where: { id: channel.id }, data: { status: 'ERROR' } })
      .catch(() => {});
    wsService.emitChannelStatus(channel.id, 'ERROR');
    return true;
  }

  private getPlaylistOutputDimensions(channel: any): { width: number; height: number; variant: string } {
    switch (channel.transcodingProfile?.resolution) {
      case 'RES_480P':
        return { width: 854, height: 480, variant: '480p' };
      case 'RES_1080P':
        return { width: 1920, height: 1080, variant: '1080p' };
      default:
        return { width: 1280, height: 720, variant: '720p' };
    }
  }

  /** One HLS rung for playlist channels (stable with overlays on CPU VPS). */
  private preparePlaylistVideoMap(
    filterComplex: string | null,
    channel: any,
    pixelFormat: 'yuv420p' | 'nv12' = 'yuv420p'
  ): { filterComplex: string; videoOut: string } {
    const { width, height } = this.getPlaylistOutputDimensions(channel);
    const base = filterComplex ? '[outv]' : '[0:v]';
    const prefix = filterComplex ? `${filterComplex};` : '';
    return {
      filterComplex:
        `${prefix}${base}scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=${pixelFormat},fps=24[vout]`,
      videoOut: '[vout]',
    };
  }

  private writePlaylistMasterPlaylist(outDir: string, variant: string): void {
    const masterPath = path.join(outDir, 'master.m3u8');
    const bandwidth =
      variant === '720p' ? 3200000 : variant === '480p' ? 1500000 : 5000000;
    const resolution =
      variant === '720p' ? '1280x720' : variant === '480p' ? '854x480' : '1920x1080';
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}`,
      `${variant}/index.m3u8`,
      '',
    ].join('\n');
    fs.writeFileSync(masterPath, body, 'utf8');
  }

  /** Buffer blueprint HLS in staging while station ID plays during return-to-schedule. */
  public async startBlueprintPrewarm(channel: any): Promise<void> {
    await this.stopBlueprintPrewarm(channel.id);
    const prewarmRoot = path.join(this.getHlsOutputPath(channel.slug), '.hybrid-prewarm');
    if (fs.existsSync(prewarmRoot)) {
      fs.rmSync(prewarmRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(prewarmRoot, { recursive: true });
    await this.startPlaylistStream(channel, { outputDir: prewarmRoot, prewarm: true });
  }

  public async stopBlueprintPrewarm(channelId: string): Promise<void> {
    const proc = this.blueprintPrewarmProcesses.get(channelId);
    if (!proc) return;
    this.blueprintPrewarmProcesses.delete(channelId);
    await this.gracefulKillProcess(proc);
  }

  public isBlueprintPrewarmRunning(channelId: string): boolean {
    return this.blueprintPrewarmProcesses.has(channelId);
  }

  private appendPlaylistStreamOutputs(
    args: string[],
    channel: any,
    outDir: string,
    videoOut: string,
    audioMap: string,
    encoder = gpuEncoderService.resolveForChannel(channel),
    startNumber?: number,
    hlsOptions?: { continueAppend?: boolean; listSize?: number; eventPlaylist?: boolean }
  ): void {
    const { variant } = this.getPlaylistOutputDimensions(channel);
    const bitrate =
      variant === '720p'
        ? { b: '2800k', max: '3200k', buf: '8400k' }
        : variant === '480p'
          ? { b: '1200k', max: '1500k', buf: '3600k' }
          : { b: '4500k', max: '5000k', buf: '12000k' };

    const segs = channel.enableDvr
      ? Math.floor(((channel.dvrWindowMinutes || 1440) * 60) / HLS_SEGMENT_SECONDS)
      : HLS_PLAYLIST_MIN_SEGMENTS;
    const listSize = hlsOptions?.listSize ?? Math.max(segs, HLS_PLAYLIST_MIN_SEGMENTS);

    const variantDir = path.join(outDir, variant);
    if (!fs.existsSync(variantDir)) fs.mkdirSync(variantDir, { recursive: true });

    const hlsFlags = hlsOptions?.continueAppend
      ? 'append_list+independent_segments+program_date_time+delete_segments+temp_file'
      : 'append_list+independent_segments+program_date_time+delete_segments+temp_file+discont_start';

    args.push('-map', videoOut, '-map', audioMap);
    gpuEncoderService.appendVideoEncodeArgs(args, encoder, bitrate, HLS_GOP_FRAMES);
    args.push(
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-max_muxing_queue_size', '2048',
    );
    if (startNumber != null && startNumber > 0) {
      args.push('-start_number', String(startNumber));
    }
    if (hlsOptions?.eventPlaylist) {
      args.push('-hls_playlist_type', 'event');
    }
    args.push(
      '-f', 'hls',
      '-hls_time', HLS_SEGMENT_SECONDS.toString(),
      '-hls_list_size', listSize.toString(),
      '-hls_flags', hlsFlags,
      '-hls_delete_threshold', '30',
      '-hls_segment_filename', path.join(outDir, variant, 'segment_%05d.ts'),
      path.join(outDir, variant, 'index.m3u8')
    );
  }

  private writeDualMasterPlaylist(outDir: string): void {
    const masterPath = path.join(outDir, 'master.m3u8');
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720',
      '720p/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480',
      '480p/index.m3u8',
      '',
    ].join('\n');
    fs.writeFileSync(masterPath, body, 'utf8');
  }

  private prepareAdaptiveMaps(
    filterComplex: string | null,
    pixelFormat: 'yuv420p' | 'nv12' = 'yuv420p',
    hasAudio = true,
    options?: { skipFpsCap?: boolean }
  ): {
    filterComplex: string;
    video720: string;
    video480: string;
    audio720?: string;
    audio480?: string;
  } {
    const base = filterComplex ? '[outv]' : '[0:v]';
    const prefix = filterComplex ? `${filterComplex};` : '';
    const fpsFilter = options?.skipFpsCap ? '' : 'fps=24,';
    let graph =
      `${prefix}${base}format=${pixelFormat},${fpsFilter}split=2[v720src][v480src];` +
      `[v720src]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v720];` +
      `[v480src]scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v480]`;

    if (hasAudio) {
      graph += ';[0:a]asplit=2[a720][a480]';
    }

    return {
      filterComplex: graph,
      video720: '[v720]',
      video480: '[v480]',
      ...(hasAudio ? { audio720: '[a720]', audio480: '[a480]' } : {}),
    };
  }

  private appendAdaptiveStreamOutputs(
    args: string[],
    channel: any,
    outDir: string,
    video720: string,
    video480: string,
    encoder = gpuEncoderService.resolveForChannel(channel),
    audio?: { audio720: string; audio480: string }
  ): void {
    const segs = channel.enableDvr
      ? Math.floor(((channel.dvrWindowMinutes || 1440) * 60) / HLS_SEGMENT_SECONDS)
      : HLS_PLAYLIST_MIN_SEGMENTS;
    const listSize = Math.max(segs, HLS_PLAYLIST_MIN_SEGMENTS);

    ['720p', '480p'].forEach((variant) => {
      const dir = path.join(outDir, variant);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    const ladder = [
      { si: 0, br: { b: '2800k', max: '3200k', buf: '9600k' }, cpuPreset: 'superfast' },
      { si: 1, br: { b: '1200k', max: '1500k', buf: '4500k' }, cpuPreset: 'superfast' },
    ];

    args.push('-map', video720);
    if (audio) {
      args.push('-map', audio.audio720, '-map', video480, '-map', audio.audio480);
    } else {
      args.push('-map', video480);
    }

    if (encoder.codec === 'libx264') {
      gpuEncoderService.appendLibx264LadderEncode(
        args,
        ladder.map((rung) => ({ si: rung.si, br: rung.br, preset: rung.cpuPreset })),
        HLS_GOP_FRAMES
      );
    } else {
      for (const rung of ladder) {
        gpuEncoderService.appendVideoEncodeArgs(args, encoder, rung.br, HLS_GOP_FRAMES, rung.si);
      }
    }

    if (audio) {
      args.push('-c:a:0', 'aac', '-b:a:0', '128k', '-ar:a:0', '48000', '-ac:a:0', '2');
      args.push('-c:a:1', 'aac', '-b:a:1', '128k', '-ar:a:1', '48000', '-ac:a:1', '2');
    }

    const varStreamMap = audio
      ? 'v:0,a:0,name:720p v:1,a:1,name:480p'
      : 'v:0,name:720p v:1,name:480p';

    args.push(
      '-max_muxing_queue_size', '2048',
      '-f', 'hls',
      '-hls_time', HLS_SEGMENT_SECONDS.toString(),
      '-hls_list_size', listSize.toString(),
      '-hls_flags', 'append_list+independent_segments+program_date_time+delete_segments+temp_file',
      '-hls_delete_threshold', '30',
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', varStreamMap,
      '-hls_segment_filename', path.join(outDir, '%v', 'segment_%05d.ts'),
      path.join(outDir, '%v', 'index.m3u8')
    );
  }

  private ffprobePath(): string {
    return env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  }

  private async probeLiveSourceHasAudio(channel: any): Promise<boolean> {
    const url = String(channel.sourceUrl || '').trim();
    if (!url) return false;

    const iptvUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const probeArgs = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      '-user_agent', iptvUa,
      '-analyzeduration', '5000000',
      '-probesize', '5000000',
      url,
    ];

    return new Promise((resolve) => {
      const probe = spawn(this.ffprobePath(), probeArgs);
      const timer = setTimeout(() => {
        probe.kill('SIGKILL');
        resolve(url.includes('.m3u8') || channel.sourceType === 'M3U8');
      }, 12_000);

      let output = '';
      probe.stdout.on('data', (d) => { output += d.toString(); });
      probe.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          resolve(url.includes('.m3u8') || channel.sourceType === 'M3U8');
          return;
        }
        resolve(output.split(/\r?\n/).some((line) => line.trim() === 'audio'));
      });
      probe.on('error', () => {
        clearTimeout(timer);
        resolve(url.includes('.m3u8') || channel.sourceType === 'M3U8');
      });
    });
  }

  // ─── Direct stream ───────────────────────────────────────

  /**
   * MCR program encoder: stream-copy from bus to HLS (single transcode already done in session).
   * Falls back to adaptive transcode only when overlays are configured.
   */
  private async startMcrBusStream(channel: any): Promise<void> {
    const hasOverlays = (channel.overlays || []).length > 0;
    if (hasOverlays) {
      logger.info(
        `[MCR_OUTPUT_SOURCE] channelId=${channel.id} encoderMode=transcode-overlays — overlays require re-encode`
      );
      await this.startDirectStream(channel, { skipFpsCap: true });
      return;
    }

    const hasAudio = await this.probeLiveSourceHasAudio(channel);
    const args: string[] = ['-hide_banner', '-loglevel', 'warning'];
    this.appendLiveInputOptions(args, channel);
    args.push('-i', channel.sourceUrl);
    args.push('-map', '0:v:0?');
    if (hasAudio) args.push('-map', '0:a:0?');
    args.push('-c:v', 'copy');
    if (hasAudio) args.push('-c:a', 'copy');

    const outDir = this.getHlsOutputPath(channel.slug);
    const variant = '720p';
    const variantDir = path.join(outDir, variant);
    if (!fs.existsSync(variantDir)) fs.mkdirSync(variantDir, { recursive: true });

    const hlsTime = 2;
    args.push(
      '-max_muxing_queue_size', '2048',
      '-f', 'hls',
      '-hls_time', String(hlsTime),
      '-hls_list_size', '12',
      '-hls_flags', 'append_list+independent_segments+delete_segments+temp_file',
      '-hls_segment_filename', path.join(variantDir, 'segment_%05d.ts'),
      path.join(variantDir, 'index.m3u8')
    );

    this.writeMcrMasterPlaylist(outDir);

    logger.info(
      `[ENCODER] channelId=${channel.id} inputUrl=${channel.sourceUrl} ffmpegPid=pending ` +
        `mode=copy-to-hls startup=starting`
    );
    logger.info(
      `[MCR_FFMPEG_PROCESS] stage=PROGRAM_ENCODER channelId=${channel.id} mode=copy-to-hls ` +
        `input=${channel.sourceUrl} audio=${hasAudio ? 'copy' : 'none'} hlsTime=${hlsTime}s`
    );
    monitorService.addLog(channel.id, 'INFO', 'MCR program encoder: stream copy → HLS (no re-encode)');

    const child = spawn(env.FFMPEG_PATH, args);
    const info = this.registerProcess(channel, child);
    info.playbackSource = 'MCR_BUS';

    logger.info(
      `[ENCODER] channelId=${channel.id} inputUrl=${channel.sourceUrl} ffmpegPid=${child.pid ?? 'none'} ` +
        `startupResult=spawned mode=MCR_BUS`
    );

    await prisma.channel.update({ where: { id: channel.id }, data: { status: 'STARTING', pid: child.pid } });
    wsService.emitChannelStatus(channel.id, 'STARTING');

    this.attachProgressParser(channel, child, info);
    this.scheduleOnlineConfirmation(channel, child, info);

    void import('./mcrBinding.service').then(({ mcrBindingService }) =>
      mcrBindingService.auditBinding(channel.id, 'program-encoder-start')
    );

    child.on('close', async (code) => {
      const wasIntentional = !this.processes.has(channel.id);
      const sourceUnreachable = info.sourceUnreachable;
      this.processes.delete(channel.id);

      prisma.channel.update({ where: { id: channel.id }, data: { pid: null } }).catch(() => {});

      if (!wasIntentional) {
        logger.warn(`FFmpeg MCR copy for ${channel.name} exited (code ${code}).`);
        monitorService.addLog(channel.id, 'WARN', `MCR encoder exited with code ${code}.`);
        if (sourceUnreachable) {
          monitorService.addLog(channel.id, 'ERROR', 'Stopped reconnecting: fix the MCR bus and restart the channel.');
          await prisma.channel.update({ where: { id: channel.id }, data: { status: 'ERROR' } });
          wsService.emitChannelStatus(channel.id, 'ERROR');
          this.reconnectAttempts.delete(channel.id);
          return;
        }
        this.triggerReconnect(channel.id);
      } else {
        prisma.channel.update({ where: { id: channel.id }, data: { status: 'OFFLINE' } }).catch(() => {});
        wsService.emitChannelStatus(channel.id, 'OFFLINE');
        this.reconnectAttempts.delete(channel.id);
      }
    });

    child.on('error', (err) => {
      logger.error(`FFmpeg MCR copy error for ${channel.name}:`, err);
      monitorService.addLog(channel.id, 'ERROR', `FFmpeg error: ${err.message}`);
    });
  }

  private writeMcrMasterPlaylist(outDir: string): void {
    const masterPath = path.join(outDir, 'master.m3u8');
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1280x720',
      '720p/index.m3u8',
      '',
    ].join('\n');
    fs.writeFileSync(masterPath, body, 'utf8');
  }

  private async startDirectStream(channel: any, options?: { skipFpsCap?: boolean }): Promise<void> {
    const hasAudio = await this.probeLiveSourceHasAudio(channel);
    const encoder = gpuEncoderService.resolveForChannel(channel);
    const args: string[] = [];

    gpuEncoderService.prependDeviceArgs(args, encoder);
    args.push(...this.getInputCustomArgs(channel));
    const overlayInputs = await overlayService.getOverlayInputs(channel.overlays || []);

    this.appendLiveInputOptions(args, channel);
    args.push('-i', channel.sourceUrl);
    args.push(...overlayInputs);

    const filterComplex = await overlayService.buildFilterComplex(channel.overlays || []);
    if (this.hasMissingImageOverlay(channel, filterComplex)) return;

    const adaptiveMaps = this.prepareAdaptiveMaps(
      filterComplex,
      encoder.pixelFormat,
      hasAudio,
      { skipFpsCap: options?.skipFpsCap }
    );
    args.push('-filter_complex', adaptiveMaps.filterComplex);

    const outDir = this.getHlsOutputPath(channel.slug);
    const audioMaps =
      hasAudio && adaptiveMaps.audio720 && adaptiveMaps.audio480
        ? { audio720: adaptiveMaps.audio720, audio480: adaptiveMaps.audio480 }
        : undefined;
    this.appendAdaptiveStreamOutputs(
      args,
      channel,
      outDir,
      adaptiveMaps.video720,
      adaptiveMaps.video480,
      encoder,
      audioMaps
    );

    logger.info(
      `Starting FFmpeg (${encoder.codec}) for channel ${channel.name} [audio=${hasAudio ? 'yes' : 'no'}]`
    );
    monitorService.addLog(channel.id, 'INFO', `Video encoder: ${encoder.label} (${encoder.codec})`);

    const child = spawn(env.FFMPEG_PATH, args);
    const info = this.registerProcess(channel, child);

    await prisma.channel.update({ where: { id: channel.id }, data: { status: 'STARTING', pid: child.pid } });
    wsService.emitChannelStatus(channel.id, 'STARTING');

    this.attachProgressParser(channel, child, info);
    this.scheduleOnlineConfirmation(channel, child, info);

    child.on('close', async (code) => {
      const wasIntentional = !this.processes.has(channel.id);
      const sourceUnreachable = info.sourceUnreachable;
      this.processes.delete(channel.id);

      prisma.channel.update({ where: { id: channel.id }, data: { pid: null } }).catch(() => {});

      if (!wasIntentional) {
        logger.warn(`FFmpeg for ${channel.name} exited (code ${code}).`);
        monitorService.addLog(channel.id, 'WARN', `FFmpeg exited with code ${code}.`);
        if (sourceUnreachable) {
          monitorService.addLog(channel.id, 'ERROR', 'Stopped reconnecting: fix the source URL and restart the channel.');
          await prisma.channel.update({ where: { id: channel.id }, data: { status: 'ERROR' } });
          wsService.emitChannelStatus(channel.id, 'ERROR');
          this.reconnectAttempts.delete(channel.id);
          return;
        }
        this.triggerReconnect(channel.id);
      } else {
        prisma.channel.update({ where: { id: channel.id }, data: { status: 'OFFLINE' } }).catch(() => {});
        wsService.emitChannelStatus(channel.id, 'OFFLINE');
        this.reconnectAttempts.delete(channel.id);
      }
    });

    child.on('error', (err) => {
      logger.error(`FFmpeg error for ${channel.name}:`, err);
      monitorService.addLog(channel.id, 'ERROR', `FFmpeg error: ${err.message}`);
    });
  }

  // ─── Startup recovery ────────────────────────────────────

  public async recoverChannels(): Promise<void> {
    const channels = await prisma.channel.findMany({
      where: { status: { in: ['ONLINE', 'STARTING'] } },
      include: { transcodingProfile: true, overlays: true, playlist: true },
    });

    if (channels.length === 0) return;

    logger.info(`Recovering ${channels.length} channel(s) that were running before shutdown...`);

    await prisma.channel.updateMany({
      where: { id: { in: channels.map((c) => c.id) } },
      data: { status: 'OFFLINE', pid: null },
    });

    for (const channel of channels) {
      monitorService.addLog(channel.id, 'INFO', 'Auto-recovering channel after server restart.');
      setTimeout(async () => {
        const { hybridChannelService } = await import('./hybridChannel.service');
        const recovered = await hybridChannelService.recover(channel.id);
        if (!recovered) {
          await this.startStream(channel);
        }
      }, 2000 + Math.random() * 3000);
    }
  }

  /** Clear reconnect backoff so manual Start works after fixing config. */
  public clearReconnectState(channelId: string): void {
    this.reconnectAttempts.delete(channelId);
  }

  // ─── Utilities ───────────────────────────────────────────

  public getProcessInfo(channelId: string): FfmpegProcessInfo | undefined {
    return this.processes.get(channelId);
  }

  public hasProcess(channelId: string): boolean {
    return this.processes.has(channelId);
  }

  /** Remove a channel from the FFmpeg process map without killing (caller owns the process). */
  public unregisterProcess(channelId: string): void {
    this.processes.delete(channelId);
    this.reconnectAttempts.delete(channelId);
  }

  /** Register the v2 permanent MCR switcher encoder with progress monitoring. */
  public registerMcrSwitcherProcess(channel: any, proc: ChildProcess): FfmpegProcessInfo {
    const info = this.registerProcess(channel, proc, 'MCR_SWITCHER');
    this.attachProgressParser(channel, proc, info);
    this.scheduleOnlineConfirmation(channel, proc, info);
    return info;
  }

  public getAllProcesses(): Map<string, FfmpegProcessInfo> {
    return this.processes;
  }

  public getHlsOutputPath(slug: string): string {
    return path.join(env.STREAMS_DIR, slug);
  }

  public ensureOutputDir(slug: string): void {
    const dir = this.getHlsOutputPath(slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export const ffmpegService = new FfmpegService();
