import { spawn, ChildProcess } from 'child_process';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { mcrRelayService } from './mcrRelay.service';

/**
 * Publishes a black slate to the MCR program bus so the program encoder can
 * connect to RTMP before the real relay source is ready.
 */
class McrBusHolderService {
  private holders = new Map<string, ChildProcess>();

  isHolding(channelId: string): boolean {
    const proc = this.holders.get(channelId);
    if (!proc?.pid) return false;
    try {
      process.kill(proc.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getHolderPid(channelId: string): number | null {
    const proc = this.holders.get(channelId);
    if (!proc?.pid || !this.isHolding(channelId)) return null;
    return proc.pid;
  }

  async startSlate(channelId: string): Promise<void> {
    if (this.isHolding(channelId)) return;

    const busUrl = mcrRelayService.getBusRtmpUrl(channelId);
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-re',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=1280x720:r=25',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=stereo',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-g', '50',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      busUrl,
    ];

    logger.info(`[MCR_BUS_SLATE] channelId=${channelId} publishing slate to ${busUrl}`);

    const proc = spawn(env.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.holders.set(channelId, proc);

    void import('./mcrBusDebugAudit.service').then(({ mcrBusDebugAuditService }) =>
      mcrBusDebugAuditService.logBusPublishStart(channelId, busUrl, proc.pid ?? null, 'slate')
    );

    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
        logger.warn(`[MCR_BUS_SLATE] channelId=${channelId} ${line.slice(0, 200)}`);
      }
    });

    proc.on('close', () => {
      if (this.holders.get(channelId) === proc) {
        this.holders.delete(channelId);
      }
    });
  }

  async stopSlate(channelId: string): Promise<void> {
    const proc = this.holders.get(channelId);
    if (!proc) return;
    this.holders.delete(channelId);
    try {
      proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
    try {
      if (proc.pid) proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

export const mcrBusHolderService = new McrBusHolderService();
