import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { ffmpegService } from '../ffmpeg.service';
import { monitorService } from '../monitor.service';
import { wsService } from '../websocket.service';
import { mcrInputRegistryService, type McrInputRegistrySnapshot } from './mcrInputRegistry.service';
import { mcrSlateService } from './mcrSlate.service';

interface SwitcherEncoderState {
  channelId: string;
  channelSlug: string;
  process: ChildProcess;
  registry: McrInputRegistrySnapshot;
  /** Registry slot index (0 = slate, 1+ = source) */
  programSlot: number;
  activeHlsPath: string;
  startedAt: number;
  usedSlatePlaceholder: boolean;
}

/**
 * Permanent program encoder — 2-input streamselect (slate + active source).
 * ZMQ hot-switch is unavailable on Alpine FFmpeg 8, so TAKE/CUT remaps via fast restart.
 */
class McrProgramEncoderService {
  private encoders = new Map<string, SwitcherEncoderState>();
  private recoveryTimers = new Map<string, NodeJS.Timeout>();
  private starting = new Set<string>();

  isRunning(channelId: string): boolean {
    const state = this.encoders.get(channelId);
    if (!state?.process.pid) return false;
    try {
      process.kill(state.process.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getState(channelId: string): SwitcherEncoderState | null {
    return this.encoders.get(channelId) ?? null;
  }

  getZmqPort(_channelId: string): number | null {
    return null;
  }

  private getHlsOutputDir(slug: string): string {
    return path.join(env.STREAMS_DIR, slug);
  }

  private writeMasterPlaylist(outDir: string): void {
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

  private async waitForHlsFile(hlsPath: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(hlsPath)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return fs.existsSync(hlsPath);
  }

  private findActiveInput(registry: McrInputRegistrySnapshot, programSlot: number) {
    if (programSlot <= 0) return null;
    return registry.inputs.find((i) => i.slotIndex === programSlot) ?? null;
  }

  /** Two inputs only: [0]=slate standby, [1]=active source (or slate if not ready). */
  private async resolveTwoInputPaths(
    registry: McrInputRegistrySnapshot,
    programSlot: number,
    slatePath: string
  ): Promise<{
    inputPaths: [string, string];
    selectMap: 0 | 1;
    activeHlsPath: string;
    usedPlaceholder: boolean;
  }> {
    const active = this.findActiveInput(registry, programSlot);
    if (!active) {
      return {
        inputPaths: [slatePath, slatePath],
        selectMap: 0,
        activeHlsPath: slatePath,
        usedPlaceholder: false,
      };
    }

    const ready = fs.existsSync(active.hlsPath) || (await this.waitForHlsFile(active.hlsPath, 3000));
    if (ready) {
      return {
        inputPaths: [slatePath, active.hlsPath],
        selectMap: 1,
        activeHlsPath: active.hlsPath,
        usedPlaceholder: false,
      };
    }

    logger.warn(
      `[MCR_PROGRAM_ENCODER] active source HLS not ready slot=${programSlot} ` +
        `label=${active.label} path=${active.hlsPath} — holding slate`
    );
    return {
      inputPaths: [slatePath, slatePath],
      selectMap: 0,
      activeHlsPath: active.hlsPath,
      usedPlaceholder: true,
    };
  }

  private buildArgs(
    inputPaths: [string, string],
    channelSlug: string,
    selectMap: 0 | 1
  ): string[] {
    const args: string[] = ['-hide_banner', '-loglevel', 'warning'];

    for (const p of inputPaths) {
      args.push(
        '-thread_queue_size',
        '512',
        '-re',
        '-stream_loop',
        '-1',
        '-probesize',
        '5000000',
        '-analyzeduration',
        '5000000',
        '-i',
        p
      );
    }

    const filterComplex =
      `[0:v][1:v]streamselect@vsel=inputs=2:map=${selectMap}[vout];` +
      `[0:a][1:a]astreamselect@asel=inputs=2:map=${selectMap}[aout]`;

    args.push('-filter_complex', filterComplex);
    args.push('-map', '[vout]', '-map', '[aout]');
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '60',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000'
    );

    const outDir = this.getHlsOutputDir(channelSlug);
    const variantDir = path.join(outDir, '720p');
    fs.mkdirSync(variantDir, { recursive: true });
    this.writeMasterPlaylist(outDir);

    args.push(
      '-max_muxing_queue_size',
      '4096',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '12',
      '-hls_flags',
      'append_list+independent_segments+delete_segments+temp_file',
      '-hls_segment_filename',
      path.join(variantDir, 'segment_%05d.ts'),
      path.join(variantDir, 'index.m3u8')
    );

    return args;
  }

  private registrySourcesChanged(
    a: McrInputRegistrySnapshot,
    b: McrInputRegistrySnapshot
  ): boolean {
    if (a.inputs.length !== b.inputs.length) return true;
    return a.inputs.some((inp, idx) => b.inputs[idx]?.sourceId !== inp.sourceId);
  }

  private clearRecoveryTimer(channelId: string): void {
    const t = this.recoveryTimers.get(channelId);
    if (t) clearTimeout(t);
    this.recoveryTimers.delete(channelId);
  }

  scheduleRecovery(channelId: string, delayMs = 8000): void {
    this.clearRecoveryTimer(channelId);
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(channelId);
      const slot = this.encoders.get(channelId)?.programSlot ?? 0;
      void this.ensureRunning(channelId, slot).catch((err) =>
        logger.warn(`[MCR_PROGRAM_ENCODER] recovery failed channelId=${channelId}: ${err}`)
      );
    }, delayMs);
    this.recoveryTimers.set(channelId, timer);
  }

  async onSessionHlsReady(channelId: string): Promise<void> {
    const state = this.encoders.get(channelId);
    if (!state?.usedSlatePlaceholder || !this.isRunning(channelId) || state.programSlot <= 0) {
      return;
    }

    const active = this.findActiveInput(state.registry, state.programSlot);
    if (!active || !fs.existsSync(active.hlsPath)) return;

    logger.info(
      `[MCR_PROGRAM_ENCODER] action=rebuild channelId=${channelId} reason=active-session-hls-ready slot=${state.programSlot}`
    );
    await this.ensureRunning(channelId, state.programSlot);
  }

  async ensureRunning(channelId: string, initialProgramSlot = 0): Promise<SwitcherEncoderState> {
    if (this.starting.has(channelId)) {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const existing = this.encoders.get(channelId);
        if (existing && this.isRunning(channelId)) return existing;
        if (!this.starting.has(channelId)) break;
      }
    }

    this.starting.add(channelId);
    try {
      return await this._ensureRunningInner(channelId, initialProgramSlot);
    } finally {
      this.starting.delete(channelId);
    }
  }

  private async _ensureRunningInner(
    channelId: string,
    initialProgramSlot: number
  ): Promise<SwitcherEncoderState> {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new Error('Channel not found');

    const slatePath = await mcrSlateService.ensureSlate();
    const registry = await mcrInputRegistryService.buildRegistry(channelId);
    const existing = this.encoders.get(channelId);

    const programSlot = Math.max(0, initialProgramSlot);
    const { inputPaths, selectMap, activeHlsPath, usedPlaceholder } =
      await this.resolveTwoInputPaths(registry, programSlot, slatePath);

    const placeholderResolved =
      existing?.usedSlatePlaceholder && !usedPlaceholder && existing.programSlot === programSlot;

    const needsRestart =
      !existing ||
      !this.isRunning(channelId) ||
      existing.programSlot !== programSlot ||
      this.registrySourcesChanged(existing.registry, registry) ||
      placeholderResolved;

    if (!needsRestart) return existing;

    if (existing) {
      await this.stop(channelId, existing.programSlot !== programSlot ? 'input-remap' : 'registry-rebuild');
    }

    const args = this.buildArgs(inputPaths, channel.slug, selectMap);

    logger.info(
      `[MCR_PROGRAM_ENCODER] action=start channelId=${channelId} slug=${channel.slug} ` +
        `inputs=2 programSlot=${programSlot} selectMap=${selectMap} placeholder=${usedPlaceholder} ` +
        `output=/stream/${channel.slug}/master.m3u8`
    );
    monitorService.addLog(
      channelId,
      'INFO',
      `MCR v2 switcher encoder started (slate + slot ${programSlot})`
    );

    const proc = spawn(env.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    const state: SwitcherEncoderState = {
      channelId,
      channelSlug: channel.slug,
      process: proc,
      registry,
      programSlot,
      activeHlsPath,
      startedAt: Date.now(),
      usedSlatePlaceholder: usedPlaceholder,
    };
    this.encoders.set(channelId, state);

    ffmpegService.registerMcrSwitcherProcess(channel, proc);

    await prisma.mcrRouterState.update({
      where: { channelId },
      data: {
        switcherEncoderPid: proc.pid ?? null,
        switcherZmqPort: null,
        architectureVersion: 'v2-switcher',
        relayPid: proc.pid ?? null,
        programInputSlot: programSlot,
      },
    });

    await prisma.channel.update({
      where: { id: channelId },
      data: { status: 'STARTING', pid: proc.pid ?? null },
    });
    wsService.emitChannelStatus(channelId, 'STARTING');

    let stderrTail = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      stderrTail = `${stderrTail}\n${line}`.slice(-1200);
      if (line.toLowerCase().includes('error')) {
        logger.warn(`[MCR_PROGRAM_ENCODER] channelId=${channelId} ${line.slice(0, 200)}`);
      }
    });

    proc.on('close', async (code) => {
      const current = this.encoders.get(channelId);
      if (current?.process !== proc) return;

      this.encoders.delete(channelId);
      ffmpegService.unregisterProcess(channelId);

      logger.warn(
        `[MCR_PROGRAM_ENCODER] exited channelId=${channelId} code=${code ?? 'null'}`
      );
      monitorService.addLog(channelId, 'WARN', `MCR switcher encoder exited (code ${code})`);
      if (stderrTail.trim()) {
        monitorService.addLog(
          channelId,
          'ERROR',
          `FFmpeg tail: ${stderrTail.trim().split('\n').slice(-4).join(' | ')}`
        );
      }

      await prisma.channel.update({
        where: { id: channelId },
        data: { status: 'ERROR', pid: null },
      });
      wsService.emitChannelStatus(channelId, 'ERROR');

      this.scheduleRecovery(channelId, 10000);
    });

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!this.isRunning(channelId)) break;
      const variantPlaylist = path.join(this.getHlsOutputDir(channel.slug), '720p', 'index.m3u8');
      if (fs.existsSync(variantPlaylist)) return state;
    }

    if (this.isRunning(channelId)) return state;

    throw new Error('MCR switcher encoder failed to start — check FFmpeg filter graph');
  }

  /** Remap active input via fast restart on the same HLS output (ZMQ unavailable on this FFmpeg). */
  async switchInputSlot(channelId: string, slotIndex: number): Promise<void> {
    const state = this.encoders.get(channelId);
    if (state?.programSlot === slotIndex && this.isRunning(channelId) && !state.usedSlatePlaceholder) {
      return;
    }

    logger.info(
      `[MCR_SWITCHER] channelId=${channelId} programSlot=${slotIndex} mode=fast-remap-restart`
    );
    await this.ensureRunning(channelId, slotIndex);
  }

  async stop(channelId: string, reason = 'explicit'): Promise<void> {
    this.clearRecoveryTimer(channelId);
    const state = this.encoders.get(channelId);
    if (!state) return;

    logger.info(`[MCR_PROGRAM_ENCODER] stop channelId=${channelId} reason=${reason}`);
    this.encoders.delete(channelId);
    ffmpegService.unregisterProcess(channelId);

    try {
      state.process.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
    try {
      if (state.process.pid) state.process.kill('SIGKILL');
    } catch {
      /* ignore */
    }

    await prisma.mcrRouterState.update({
      where: { channelId },
      data: { switcherEncoderPid: null, relayPid: null },
    });
  }
}

export const mcrProgramEncoderService = new McrProgramEncoderService();
