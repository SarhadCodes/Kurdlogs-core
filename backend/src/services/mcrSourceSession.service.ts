import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { McrSourceType } from '@prisma/client';
import { env } from '../config/env';
import { buildMcrRtmpUrl } from '../config/mcrRtmp';
import { logger } from '../utils/logger';
import { parseFfmpegProgress } from '../utils/helpers';
import { getStreamRoot } from '../utils/streamPaths';
import { mcrIngestService } from './mcrIngest.service';
import type { McrRelayInput } from './mcrRelay.service';

export type McrSessionStatus = 'CONNECTING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE';

export interface McrSessionMetrics {
  sessionId: string;
  status: McrSessionStatus;
  fps: number;
  bitrate: number;
  width: number | null;
  height: number | null;
  resolution: string | null;
  audioPresent: boolean;
  lastFrameAt: number | null;
  frozen: boolean;
}

interface SourceSession {
  routerChannelId: string;
  sourceId: string;
  sessionKey: string;
  process: ChildProcess;
  pid: number;
  input: McrRelayInput;
  startedAt: number;
  connected: boolean;
  restartTimer: NodeJS.Timeout | null;
  stopped: boolean;
  status: McrSessionStatus;
  fps: number;
  bitrate: number;
  width: number | null;
  height: number | null;
  audioPresent: boolean;
  lastFrameAt: number | null;
  lastSegmentAt: number | null;
  frameCount: number;
  lastFrameChangeAt: number;
  frozen: boolean;
  frozenLoggedAt: number | null;
  sessionReadyEmitted: boolean;
  hlsWatchTimer: NodeJS.Timeout | null;
}

/**
 * Persistent per-source FFmpeg sessions. Each source in the MCR bin maintains its own
 * upstream connection and publishes to a dedicated session RTMP + HLS tap.
 * TAKE/CUT only reroutes the program bus relay — source sessions are never restarted.
 */
class McrSourceSessionService {
  private sessions = new Map<string, SourceSession>();

  private mapKey(routerChannelId: string, sourceId: string): string {
    return `${routerChannelId}:${sourceId}`;
  }

  getSessionKey(routerChannelId: string, sourceId: string): string {
    return `mcr-sess-${routerChannelId.slice(0, 8)}-${sourceId.slice(0, 8)}`;
  }

  getSessionRtmpUrl(routerChannelId: string, sourceId: string): string {
    return buildMcrRtmpUrl(this.getSessionKey(routerChannelId, sourceId));
  }

  getSessionPreviewSlug(routerChannelId: string, sourceId: string): string {
    return this.getSessionKey(routerChannelId, sourceId);
  }

  isRunning(routerChannelId: string, sourceId: string): boolean {
    const session = this.sessions.get(this.mapKey(routerChannelId, sourceId));
    if (!session?.process.pid) return false;
    try {
      process.kill(session.process.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getSessionInfo(
    routerChannelId: string,
    sourceId: string
  ): { pid: number; sessionKey: string; uptimeSec: number; connected: boolean; status: McrSessionStatus } | null {
    const session = this.sessions.get(this.mapKey(routerChannelId, sourceId));
    if (!session) return null;
    return {
      pid: session.pid,
      sessionKey: session.sessionKey,
      uptimeSec: Math.floor((Date.now() - session.startedAt) / 1000),
      connected: session.connected,
      status: session.status,
    };
  }

  getSessionMetrics(routerChannelId: string, sourceId: string): McrSessionMetrics | null {
    const session = this.sessions.get(this.mapKey(routerChannelId, sourceId));
    if (!session) return null;
    return this.toMetrics(session);
  }

  isSourceFrozen(routerChannelId: string, sourceId: string): boolean {
    const session = this.sessions.get(this.mapKey(routerChannelId, sourceId));
    return session?.frozen ?? false;
  }

  tickSessionHealth(routerChannelId: string, sourceId: string): void {
    const session = this.sessions.get(this.mapKey(routerChannelId, sourceId));
    if (!session || session.stopped) return;

    if (!this.isRunning(routerChannelId, sourceId)) {
      session.status = 'OFFLINE';
      return;
    }

    const now = Date.now();
    if (session.frameCount > 0 && now - session.lastFrameChangeAt > 10_000) {
      if (!session.frozen) {
        session.frozen = true;
        if (!session.frozenLoggedAt || now - session.frozenLoggedAt > 30_000) {
          session.frozenLoggedAt = now;
          logger.warn(
            `[MCR_SOURCE_FROZEN] routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
              `sessionKey=${session.sessionKey} frames=${session.frameCount} ` +
              `lastFrameAt=${session.lastFrameAt ?? 'none'} stallSec=${Math.round((now - session.lastFrameChangeAt) / 1000)}`
          );
        }
      }
    }

    if (session.lastSegmentAt && now - session.lastSegmentAt > 8000) {
      session.status = 'DEGRADED';
    } else if (session.connected && session.lastSegmentAt) {
      session.status = 'ONLINE';
    } else if (this.isRunning(routerChannelId, sourceId)) {
      session.status = session.connected ? 'DEGRADED' : 'CONNECTING';
    }
  }

  private toMetrics(session: SourceSession): McrSessionMetrics {
    return {
      sessionId: session.sessionKey,
      status: session.status,
      fps: session.fps,
      bitrate: session.bitrate,
      width: session.width,
      height: session.height,
      resolution: session.width && session.height ? `${session.width}x${session.height}` : null,
      audioPresent: session.audioPresent,
      lastFrameAt: session.lastFrameAt,
      frozen: session.frozen,
    };
  }

  private startHlsWatcher(session: SourceSession): void {
    if (session.hlsWatchTimer) clearInterval(session.hlsWatchTimer);
    const hlsDir = getStreamRoot(session.sessionKey);

    session.hlsWatchTimer = setInterval(() => {
      if (session.stopped) return;
      const manifest = path.join(hlsDir, 'index.m3u8');
      if (!fs.existsSync(manifest)) return;

      const manifestMtime = fs.statSync(manifest).mtimeMs;
      let latestSeg = manifestMtime;
      try {
        for (const name of fs.readdirSync(hlsDir)) {
          if (!name.endsWith('.ts')) continue;
          const m = fs.statSync(path.join(hlsDir, name)).mtimeMs;
          if (m > latestSeg) latestSeg = m;
        }
      } catch {
        /* ignore */
      }

      if (latestSeg <= (session.lastSegmentAt ?? 0)) return;

      session.lastSegmentAt = latestSeg;
      session.lastFrameAt = latestSeg;
      session.lastFrameChangeAt = Date.now();
      session.frozen = false;
      session.frozenLoggedAt = null;
      session.status = 'ONLINE';
      session.connected = true;

      if (!session.sessionReadyEmitted) {
        session.sessionReadyEmitted = true;
        logger.info(
          `[MCR_PREVIEW_ACTIVE] routerChannelId=${session.routerChannelId} sourceId=${session.sourceId} ` +
            `sessionKey=${session.sessionKey} previewReady=true`
        );
        void import('./websocket.service').then(({ wsService }) => {
          wsService.emitMcrSessionReady({
            channelId: session.routerChannelId,
            sourceId: session.sourceId,
            sessionKey: session.sessionKey,
            manifest: 'index.m3u8',
          });
        });
        void import('./mcr/mcrProgramEncoder.service').then(({ mcrProgramEncoderService }) =>
          mcrProgramEncoderService.onSessionHlsReady(session.routerChannelId)
        );
      }
    }, 1000);
  }

  private attachProgressParser(session: SourceSession): void {
    session.process.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
        logger.warn(
          `[MCR_SESSION] routerChannelId=${session.routerChannelId} sourceId=${session.sourceId} ` +
            `sessionKey=${session.sessionKey} ${line.slice(0, 220)}`
        );
      }

      const stats = parseFfmpegProgress(line);
      if (!stats) return;

      if (typeof stats.frames === 'number') {
        if (stats.frames !== session.frameCount) {
          session.frameCount = stats.frames;
          session.lastFrameChangeAt = Date.now();
          session.lastFrameAt = Date.now();
          session.frozen = false;
          session.frozenLoggedAt = null;
        }
      }
      if (typeof stats.fps === 'number' && stats.fps > 0) session.fps = stats.fps;
      if (typeof stats.bitrate === 'number') session.bitrate = stats.bitrate;
      if (stats.frames !== undefined) session.audioPresent = true;
    });
  }

  async ensureSession(
    routerChannelId: string,
    sourceId: string,
    input: McrRelayInput,
    label?: string
  ): Promise<string> {
    const key = this.mapKey(routerChannelId, sourceId);
    const existing = this.sessions.get(key);
    if (existing && !existing.stopped && this.isRunning(routerChannelId, sourceId)) {
      if (existing.input.url === input.url && existing.input.kind === input.kind) {
        logger.info(
          `[MCR_SESSION] action=reuse routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
            `sessionKey=${existing.sessionKey} label=${label ?? 'unknown'}`
        );
        return existing.sessionKey;
      }
      logger.info(
        `[MCR_SESSION] action=input-changed routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
          `oldInput=${existing.input.url.slice(0, 80)} newInput=${input.url.slice(0, 80)}`
      );
      await this.stopSession(routerChannelId, sourceId, 'input-changed');
    }

    const sessionKey = this.getSessionKey(routerChannelId, sourceId);
    const streamRoot = getStreamRoot(sessionKey);
    fs.mkdirSync(streamRoot, { recursive: true });

    const args = this.buildSessionArgs(input, sessionKey);
    logger.info(
      `[MCR_SESSION_CREATE] routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
        `sessionKey=${sessionKey} inputKind=${input.kind} inputUrl=${input.url.slice(0, 120)} ` +
        `label=${label ?? 'unknown'}`
    );

    const proc = spawn(env.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const session: SourceSession = {
      routerChannelId,
      sourceId,
      sessionKey,
      process: proc,
      pid: proc.pid ?? 0,
      input,
      startedAt: Date.now(),
      connected: false,
      restartTimer: null,
      stopped: false,
      status: 'CONNECTING',
      fps: 0,
      bitrate: 0,
      width: null,
      height: null,
      audioPresent: false,
      lastFrameAt: null,
      lastSegmentAt: null,
      frameCount: 0,
      lastFrameChangeAt: Date.now(),
      frozen: false,
      frozenLoggedAt: null,
      sessionReadyEmitted: false,
      hlsWatchTimer: null,
    };
    this.sessions.set(key, session);
    this.attachProgressParser(session);
    this.startHlsWatcher(session);

    const connectTimer = setTimeout(() => {
      void this.onSessionConnected(routerChannelId, sourceId, sessionKey, proc.pid ?? 0);
    }, 3000);

    proc.on('close', (code) => {
      clearTimeout(connectTimer);
      if (session.hlsWatchTimer) clearInterval(session.hlsWatchTimer);
      const current = this.sessions.get(key);
      if (current?.process !== proc) return;

      logger.warn(
        `[MCR_SOURCE_DISCONNECTED] routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
          `sessionKey=${sessionKey} exitCode=${code ?? 'null'}`
      );
      logger.warn(
        `[MCR_SESSION_DISCONNECT] routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
          `sessionKey=${sessionKey} exitCode=${code ?? 'null'}`
      );

      if (current.stopped) {
        this.sessions.delete(key);
        return;
      }

      const savedInput = current.input;
      const savedLabel = label;
      this.sessions.delete(key);

      current.restartTimer = setTimeout(() => {
        if (this.isRunning(routerChannelId, sourceId)) return;
        logger.info(
          `[MCR_SESSION] action=auto-restart routerChannelId=${routerChannelId} ` +
            `sourceId=${sourceId} sessionKey=${sessionKey}`
        );
        void this.ensureSession(routerChannelId, sourceId, savedInput, savedLabel);
      }, 5000);
    });

    return sessionKey;
  }

  private onSessionConnected(
    routerChannelId: string,
    sourceId: string,
    sessionKey: string,
    pid: number
  ): void {
    const current = this.sessions.get(this.mapKey(routerChannelId, sourceId));
    if (!current || current.sessionKey !== sessionKey) return;
    current.connected = true;
    logger.info(
      `[MCR_SOURCE_CONNECTED] routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
        `sessionKey=${sessionKey} pid=${pid}`
    );
    logger.info(
      `[MCR_SESSION_CONNECT] routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
        `sessionKey=${sessionKey} pid=${pid}`
    );
    void this.tryRouteProgramBus(routerChannelId, sourceId);
  }

  /** When a program-source session comes online, reroute the bus if needed. */
  private async tryRouteProgramBus(routerChannelId: string, sourceId: string): Promise<void> {
    try {
      const { sourceRouterService } = await import('./sourceRouter.service');
      await sourceRouterService.retryProgramBusRoute(routerChannelId, sourceId);
    } catch (err) {
      logger.warn(
        `[MCR_SESSION] bus-reroute-skipped routerChannelId=${routerChannelId} ` +
          `sourceId=${sourceId} reason=${err}`
      );
    }
  }

  async stopSession(
    routerChannelId: string,
    sourceId: string,
    reason = 'explicit'
  ): Promise<void> {
    const key = this.mapKey(routerChannelId, sourceId);
    const session = this.sessions.get(key);
    if (!session) return;

    logger.info(
      `[MCR_SESSION_DESTROY] routerChannelId=${routerChannelId} sourceId=${sourceId} ` +
        `sessionKey=${session.sessionKey} reason=${reason} pid=${session.pid}`
    );

    session.stopped = true;
    if (session.restartTimer) clearTimeout(session.restartTimer);
    if (session.hlsWatchTimer) clearInterval(session.hlsWatchTimer);
    this.sessions.delete(key);
    try {
      session.process.kill('SIGTERM');
    } catch {
      /* already dead */
    }
    await new Promise((r) => setTimeout(r, 300));
    try {
      if (session.process.pid) session.process.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }

  async stopAllForRouter(routerChannelId: string, reason = 'router-stop'): Promise<void> {
    const toStop = [...this.sessions.values()].filter((s) => s.routerChannelId === routerChannelId);
    for (const session of toStop) {
      await this.stopSession(routerChannelId, session.sourceId, reason);
    }
  }

  /** Start sessions for all enabled sources; stop sessions for removed sources. */
  async syncRouterSessions(
    routerChannelId: string,
    sources: Array<{
      id: string;
      label: string;
      enabled: boolean;
      sourceType: McrSourceType;
      refChannelId: string | null;
      inputUrl: string | null;
      streamKey?: string | null;
    }>,
    resolveInput: (source: {
      sourceType: McrSourceType;
      refChannelId: string | null;
      inputUrl: string | null;
      streamKey?: string | null;
    }) => Promise<McrRelayInput | null>
  ): Promise<void> {
    const activeIds = new Set<string>();

    for (const source of sources) {
      if (!source.enabled) continue;
      const input = await resolveInput(source);
      if (!input) {
        logger.warn(
          `[MCR_SESSION] action=skip-unresolved routerChannelId=${routerChannelId} ` +
            `sourceId=${source.id} label=${source.label}`
        );
        continue;
      }
      activeIds.add(source.id);
      await this.ensureSession(routerChannelId, source.id, input, source.label);
    }

    for (const session of [...this.sessions.values()]) {
      if (session.routerChannelId !== routerChannelId) continue;
      if (!activeIds.has(session.sourceId)) {
        await this.stopSession(routerChannelId, session.sourceId, 'source-removed');
      }
    }

    logger.info(
      `[MCR_SESSION_SYNC] routerChannelId=${routerChannelId} active=${activeIds.size} ` +
        `running=${[...this.sessions.values()].filter((s) => s.routerChannelId === routerChannelId).length}`
    );
  }

  async waitForPublisher(
    routerChannelId: string,
    sourceId: string,
    timeoutMs = 12000
  ): Promise<boolean> {
    const route = await this.resolveSessionRouteInput(routerChannelId, sourceId, timeoutMs);
    return route !== null;
  }

  private static readonly MAX_HLS_ROUTE_AGE_MS = 20_000;

  private getSessionHlsPlaylistAgeMs(sessionKey: string): number | null {
    const root = getStreamRoot(sessionKey);
    const hlsPath = path.join(root, 'index.m3u8');
    if (!fs.existsSync(hlsPath)) return null;

    let newestMtime = fs.statSync(hlsPath).mtimeMs;
    try {
      for (const name of fs.readdirSync(root)) {
        if (!name.endsWith('.ts')) continue;
        newestMtime = Math.max(newestMtime, fs.statSync(path.join(root, name)).mtimeMs);
      }
    } catch {
      /* ignore */
    }
    return Date.now() - newestMtime;
  }

  private logRouteDecision(
    sessionKey: string,
    candidate: string,
    kind: string,
    accepted: boolean,
    reason: string,
    extras?: { bitrate?: number; playlistAgeMs?: number | null }
  ): void {
    logger.info(
      `[MCR_ROUTE_DECISION] sessionKey=${sessionKey} candidate=${candidate} kind=${kind} ` +
        `bitrate=${extras?.bitrate ?? 'n/a'} playlistAgeMs=${extras?.playlistAgeMs ?? 'n/a'} ` +
        `accepted=${accepted} reason=${reason}`
    );
  }

  /**
   * Resolve how the program bus relay should read from a persistent session.
   * Prefers session RTMP tap on nginx; falls back to live session HLS on disk only if fresh.
   */
  async resolveSessionRouteInput(
    routerChannelId: string,
    sourceId: string,
    timeoutMs = 12000
  ): Promise<McrRelayInput | null> {
    const sessionKey = this.getSessionKey(routerChannelId, sourceId);
    const rtmpUrl = this.getSessionRtmpUrl(routerChannelId, sourceId);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.isRunning(routerChannelId, sourceId)) {
        if (await mcrIngestService.isStreamPublishingWithMedia(sessionKey)) {
          this.logRouteDecision(sessionKey, rtmpUrl, 'RTMP', true, 'session-rtmp-live');
          logger.info(
            `[MCR_PROGRAM_BUS_SOURCE] route=session-rtmp routerChannelId=${routerChannelId} ` +
              `sourceId=${sourceId} sessionKey=${sessionKey}`
          );
          return { url: rtmpUrl, kind: 'RTMP', label: sessionKey };
        }

        this.logRouteDecision(sessionKey, rtmpUrl, 'RTMP', false, 'session-rtmp-not-ready');

        const hlsPath = path.join(getStreamRoot(sessionKey), 'index.m3u8');
        const playlistAgeMs = this.getSessionHlsPlaylistAgeMs(sessionKey);
        if (playlistAgeMs !== null) {
          if (playlistAgeMs < McrSourceSessionService.MAX_HLS_ROUTE_AGE_MS) {
            this.logRouteDecision(sessionKey, hlsPath, 'HLS_FILE', true, 'session-hls-fresh', {
              playlistAgeMs,
            });
            logger.info(
              `[MCR_PROGRAM_BUS_SOURCE] route=session-hls-fallback routerChannelId=${routerChannelId} ` +
                `sourceId=${sourceId} sessionKey=${sessionKey} hlsAgeMs=${Math.round(playlistAgeMs)}`
            );
            return { url: hlsPath, kind: 'HLS_FILE', label: sessionKey };
          }

          logger.warn(
            `[MCR_STALE_HLS_REJECTED] sessionKey=${sessionKey} playlistAgeMs=${Math.round(playlistAgeMs)}`
          );
          this.logRouteDecision(sessionKey, hlsPath, 'HLS_FILE', false, 'session-hls-stale', {
            playlistAgeMs,
          });
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (this.isRunning(routerChannelId, sourceId)) {
      const hlsPath = path.join(getStreamRoot(sessionKey), 'index.m3u8');
      const playlistAgeMs = this.getSessionHlsPlaylistAgeMs(sessionKey);
      if (playlistAgeMs !== null) {
        logger.warn(
          `[MCR_STALE_HLS_REJECTED] sessionKey=${sessionKey} playlistAgeMs=${Math.round(playlistAgeMs)}`
        );
        this.logRouteDecision(sessionKey, hlsPath, 'HLS_FILE', false, 'session-hls-late-rejected', {
          playlistAgeMs,
        });
      }
    }

    return null;
  }

  private buildSessionArgs(input: McrRelayInput, sessionKey: string): string[] {
    const rtmpOut = buildMcrRtmpUrl(sessionKey);
    const hlsOut = path.join(getStreamRoot(sessionKey), 'index.m3u8');
    const teeTarget =
      `[f=flv]${rtmpOut}|` +
      `[f=hls:hls_time=2:hls_list_size=8:hls_flags=delete_segments+append_list+omit_endlist]${hlsOut}`;

    const args: string[] = ['-hide_banner', '-loglevel', 'warning'];

    if (input.kind === 'HLS_FILE') {
      args.push('-re', '-stream_loop', '-1', '-i', input.url);
      args.push(
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-g', '50',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-f', 'tee',
        teeTarget
      );
      return args;
    }

    if (input.kind === 'HLS_URL' || input.kind === 'HTTP') {
      args.push(
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '10',
        '-i', input.url
      );
    } else if (input.kind === 'MPEGTS') {
      args.push('-re', '-i', input.url);
    } else if (input.kind === 'UDP') {
      args.push('-i', input.url);
    } else if (input.kind === 'RTMP') {
      args.push('-i', input.url);
      args.push(
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'tee',
        teeTarget
      );
      return args;
    } else {
      args.push('-i', input.url);
    }

    // Transcode ensures tee has streams even when upstream codec/container varies
    args.push(
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-g', '50',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-f', 'tee',
      teeTarget
    );
    return args;
  }
}

export const mcrSourceSessionService = new McrSourceSessionService();
