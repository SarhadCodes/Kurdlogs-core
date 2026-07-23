import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { buildMcrRtmpUrl } from '../config/mcrRtmp';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getPublishedHlsManifest, getStreamRoot } from '../utils/streamPaths';

export interface McrBusRouteOptions {
  fadeMs?: number;
}

export type McrRelayInputKind =
  | 'HLS_FILE'
  | 'RTMP'
  | 'SRT'
  | 'RTSP'
  | 'HLS_URL'
  | 'HTTP'
  | 'MPEGTS'
  | 'UDP';

export interface McrRelayInput {
  url: string;
  kind: McrRelayInputKind;
  label?: string;
}

interface RelayProcess {
  channelId: string;
  process: ChildProcess;
  pid: number;
  input: McrRelayInput;
  startedAt: number;
  routedSourceId?: string;
}

/**
 * Program bus router — reads from a persistent source session RTMP tap and publishes
 * to the program bus. Only this thin relay restarts on TAKE/CUT; source sessions stay alive.
 */
class McrRelayService {
  private relays = new Map<string, RelayProcess>();

  getBusStreamKey(channelId: string): string {
    return `mcr-${channelId}`;
  }

  getBusRtmpUrl(channelId: string): string {
    return buildMcrRtmpUrl(this.getBusStreamKey(channelId));
  }

  resolveChannelHlsInput(slug: string): McrRelayInput | null {
    const manifest = getPublishedHlsManifest(slug);
    if (!manifest) return null;
    const filePath = path.join(getStreamRoot(slug), manifest);
    return { url: filePath, kind: 'HLS_FILE', label: slug };
  }

  isRunning(channelId: string): boolean {
    const relay = this.relays.get(channelId);
    if (!relay?.process.pid) return false;
    try {
      process.kill(relay.process.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getRelayInfo(channelId: string): {
    pid: number;
    inputUrl: string;
    uptimeSec: number;
    routedSourceId?: string;
  } | null {
    const relay = this.relays.get(channelId);
    if (!relay) return null;
    return {
      pid: relay.pid,
      inputUrl: relay.input.url,
      uptimeSec: Math.floor((Date.now() - relay.startedAt) / 1000),
      routedSourceId: relay.routedSourceId,
    };
  }

  /**
   * Reroute program bus to an already-running source session. Does not touch the source session.
   */
  async routeBusToSession(
    channelId: string,
    sourceId: string,
    routeInput: McrRelayInput,
    label?: string,
    sessionAlive = true,
    options?: McrBusRouteOptions
  ): Promise<void> {
    const fadeMs = options?.fadeMs ?? 0;
    const existing = this.relays.get(channelId);
    if (
      sessionAlive &&
      existing &&
      this.isRunning(channelId) &&
      existing.input.url === routeInput.url &&
      existing.input.kind === routeInput.kind &&
      existing.routedSourceId === sourceId &&
      fadeMs <= 0
    ) {
      logger.info(
        `[MCR_ROUTING_CHANGED] action=no-op channelId=${channelId} sourceId=${sourceId} ` +
          `routeKind=${routeInput.kind} routeUrl=${routeInput.url} label=${label ?? 'unknown'}`
      );
      return;
    }

    const fromUrl = existing?.input.url;
    const canFade =
      fadeMs > 0 &&
      fromUrl &&
      fromUrl !== routeInput.url &&
      existing?.input.kind === 'RTMP' &&
      routeInput.kind === 'RTMP' &&
      this.isRunning(channelId);

    if (canFade) {
      logger.info(
        `[MCR_ROUTING_CHANGED] action=fade channelId=${channelId} sourceId=${sourceId} ` +
          `fromSourceId=${existing?.routedSourceId ?? 'none'} fadeMs=${fadeMs} ` +
          `bus=${this.getBusRtmpUrl(channelId)} label=${label ?? 'unknown'}`
      );
      await this.crossfadeBus(channelId, fromUrl, routeInput.url, sourceId, label, fadeMs);
      return;
    }

    logger.info(
      `[MCR_ROUTING_CHANGED] action=reroute channelId=${channelId} sourceId=${sourceId} ` +
        `fromSourceId=${existing?.routedSourceId ?? 'none'} routeKind=${routeInput.kind} ` +
        `routeUrl=${routeInput.url.slice(0, 120)} bus=${this.getBusRtmpUrl(channelId)} label=${label ?? 'unknown'}`
    );

    const input: McrRelayInput = {
      ...routeInput,
      label: label ?? routeInput.label ?? sourceId,
    };
    await this.switchInput(channelId, input, sourceId);
  }

  private async crossfadeBus(
    channelId: string,
    fromUrl: string,
    toUrl: string,
    sourceId: string,
    label: string | undefined,
    fadeMs: number
  ): Promise<void> {
    await this.stopRelay(channelId, 'fade-start');
    const busUrl = this.getBusRtmpUrl(channelId);
    const d = Math.max(0.1, fadeMs / 1000);
    const duration = Math.ceil(d + 1);

    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-thread_queue_size',
      '1024',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '3',
      '-i',
      fromUrl,
      '-thread_queue_size',
      '1024',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '3',
      '-i',
      toUrl,
      '-filter_complex',
      `[0:v]setpts=PTS-STARTPTS[v0];[1:v]setpts=PTS-STARTPTS[v1];` +
        `[v0][v1]xfade=transition=fade:duration=${d}:offset=0[v];` +
        `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0];` +
        `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1];` +
        `[a0][a1]acrossfade=d=${d}[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '50',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-t',
      String(duration),
      '-f',
      'flv',
      '-flvflags',
      'no_duration_filesize',
      busUrl,
    ];

    logger.info(
      `[MCR_RELAY_START] channelId=${channelId} routedSourceId=${sourceId} mode=fade ` +
        `fadeMs=${fadeMs} bus=${busUrl}`
    );

    const proc = spawn(env.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
        logger.warn(`[MCR_RELAY] channelId=${channelId} fade ${line.slice(0, 200)}`);
      }
    });

    const steadyInput: McrRelayInput = { url: toUrl, kind: 'RTMP', label: label ?? sourceId };

    proc.on('close', (code) => {
      const current = this.relays.get(channelId);
      if (current?.process === proc) {
        this.relays.delete(channelId);
      }
      if (code !== 0 && code !== null) {
        logger.warn(
          `[MCR_RELAY_STOP] channelId=${channelId} routedSourceId=${sourceId} ` +
            `mode=fade exitCode=${code}`
        );
      }
      void this.startRelay(channelId, steadyInput, sourceId);
    });

    this.relays.set(channelId, {
      channelId,
      process: proc,
      pid: proc.pid ?? 0,
      input: steadyInput,
      startedAt: Date.now(),
      routedSourceId: sourceId,
    });
  }

  async switchInput(
    channelId: string,
    input: McrRelayInput,
    routedSourceId?: string
  ): Promise<void> {
    const { mcrBusHolderService } = await import('./mcrBusHolder.service');
    const hadRelay = this.isRunning(channelId);

    await this.stopRelay(channelId, 'bus-reroute');

    // Bridge publisher gap: nginx drops the stream key when relay stops.
    // Keep slate publishing until the new relay is confirmed on nginx.
    if (!mcrBusHolderService.isHolding(channelId)) {
      logger.info(
        `[MCR_RELAY] channelId=${channelId} action=slate-bridge reason=relay-reroute hadRelay=${hadRelay}`
      );
      await mcrBusHolderService.startSlate(channelId);
    }

    await this.startRelay(channelId, input, routedSourceId);
  }

  async startRelay(
    channelId: string,
    input: McrRelayInput,
    routedSourceId?: string
  ): Promise<void> {
    if (this.isRunning(channelId)) {
      const existing = this.relays.get(channelId);
      if (existing?.input.url === input.url) return;
      await this.stopRelay(channelId, 'input-change');
    }

    const busUrl = this.getBusRtmpUrl(channelId);
    const args = this.buildRelayArgs(input, busUrl);

    logger.info(
      `[MCR_RELAY] channelId=${channelId} action=start publishUrl=${busUrl} ` +
        `streamKey=${this.getBusStreamKey(channelId)} routedSourceId=${routedSourceId ?? 'none'} ` +
        `input=${input.kind} connected=publishing`
    );
    logger.info(
      `[MCR_RELAY_START] channelId=${channelId} routedSourceId=${routedSourceId ?? 'none'} ` +
        `input=${input.kind} url=${input.url.slice(0, 120)} bus=${busUrl}`
    );

    const proc = spawn(env.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    void import('./mcrBusDebugAudit.service').then(({ mcrBusDebugAuditService }) =>
      mcrBusDebugAuditService.logBusPublishStart(channelId, busUrl, proc.pid ?? null, 'relay')
    );

    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
        logger.warn(`[MCR_RELAY] channelId=${channelId} ${line.slice(0, 200)}`);
      }
    });

    proc.on('close', (code) => {
      const current = this.relays.get(channelId);
      if (current?.process === proc) {
        this.relays.delete(channelId);
        if (code !== 0 && code !== null) {
          logger.warn(
            `[MCR_RELAY_STOP] channelId=${channelId} routedSourceId=${current.routedSourceId ?? 'none'} ` +
              `exitCode=${code}`
          );
        }
        // Keep bus alive for program encoder — fall back to slate when relay dies
        void import('./mcrBusHolder.service').then(({ mcrBusHolderService }) => {
          if (!mcrBusHolderService.isHolding(channelId)) {
            logger.info(`[MCR_BUS_SLATE] channelId=${channelId} action=relay-fallback`);
            void mcrBusHolderService.startSlate(channelId);
          }
        });
      }
    });

    this.relays.set(channelId, {
      channelId,
      process: proc,
      pid: proc.pid ?? 0,
      input,
      startedAt: Date.now(),
      routedSourceId,
    });
  }

  async stopRelay(channelId: string, reason = 'explicit'): Promise<void> {
    const relay = this.relays.get(channelId);
    if (!relay) return;
    logger.info(
      `[MCR_RELAY] channelId=${channelId} action=stop reason=${reason} ` +
        `streamKey=${this.getBusStreamKey(channelId)} publishUrl=${this.getBusRtmpUrl(channelId)} ` +
        `connected=disconnecting pid=${relay.pid}`
    );
    logger.info(
      `[MCR_RELAY_STOP] channelId=${channelId} routedSourceId=${relay.routedSourceId ?? 'none'} ` +
        `reason=${reason} pid=${relay.pid}`
    );
    this.relays.delete(channelId);
    try {
      relay.process.kill('SIGTERM');
    } catch {
      /* already dead */
    }
    await new Promise((r) => setTimeout(r, 300));
    try {
      if (relay.process.pid) relay.process.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }

  private buildRelayArgs(input: McrRelayInput, busUrl: string): string[] {
    const args: string[] = ['-hide_banner', '-loglevel', 'warning'];

    if (input.kind === 'HLS_FILE') {
      args.push('-stream_loop', '-1', '-i', input.url);
    } else if (input.kind === 'HLS_URL' || input.kind === 'HTTP') {
      args.push(
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', input.url
      );
    } else if (input.kind === 'MPEGTS') {
      args.push('-re', '-i', input.url);
    } else if (input.kind === 'UDP') {
      args.push('-i', input.url);
    } else if (input.kind === 'RTMP') {
      args.push(
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '3',
        '-i', input.url
      );
    } else {
      args.push('-i', input.url);
    }

    args.push(
      '-c', 'copy',
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      busUrl
    );
    return args;
  }
}

export const mcrRelayService = new McrRelayService();
