import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { env } from '../../config/env';
import { getStreamRoot } from '../../utils/streamPaths';
import { logger } from '../../utils/logger';

/** Global black+silence HLS loop used as switcher input slot 0 (standby). */
class McrSlateService {
  static readonly SLATE_KEY = '_mcr_slate';

  private process: ChildProcess | null = null;

  getSlateHlsPath(): string {
    return path.join(getStreamRoot(McrSlateService.SLATE_KEY), 'index.m3u8');
  }

  isRunning(): boolean {
    if (!this.process?.pid) return false;
    try {
      process.kill(this.process.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async ensureSlate(): Promise<string> {
    const hlsPath = this.getSlateHlsPath();
    const root = path.dirname(hlsPath);
    fs.mkdirSync(root, { recursive: true });

    if (this.isRunning() && fs.existsSync(hlsPath)) {
      return hlsPath;
    }

    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.process = null;
    }

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=1280x720:r=30',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-shortest',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'stillimage',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '60',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '6',
      '-hls_flags',
      'delete_segments+append_list+omit_endlist',
      '-hls_segment_filename',
      path.join(root, 'seg_%03d.ts'),
      hlsPath,
    ];

    const proc = spawn(env.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.process = proc;

    proc.on('close', (code) => {
      if (this.process === proc) {
        this.process = null;
        logger.warn(`[MCR_SLATE] exited code=${code ?? 'null'} — will restart on next ensure`);
      }
    });

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (fs.existsSync(hlsPath)) {
        logger.info(`[MCR_SLATE] ready path=${hlsPath} pid=${proc.pid ?? 'none'}`);
        return hlsPath;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error('MCR slate HLS did not become ready in time');
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    try {
      this.process.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    this.process = null;
  }
}

export const mcrSlateService = new McrSlateService();
