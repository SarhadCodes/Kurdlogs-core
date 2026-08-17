import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import { env } from '../config/env';
import {
  newestSegmentInVariant,
  StreamOutputMode,
} from '../utils/streamPaths';

export type HlsContentHealthStatus = 'healthy' | 'black' | 'invalid' | 'missing';

export interface HlsContentHealthResult {
  status: HlsContentHealthStatus;
  segmentPath: string | null;
  segmentSize: number | null;
  blackDuration: number;
  detail?: string;
}

// A logo burned over a dead black canvas can occupy roughly 5-12% of the
// picture. The threshold intentionally leaves room for that overlay while the
// repeated-probe guard in each watchdog avoids reacting to ordinary cuts or
// short black frames in program material.
const BLACK_PICTURE_RATIO = 0.86;
const BLACK_PIXEL_THRESHOLD = 0.10;
const BLACK_DURATION_SECONDS = 4.5;
const PROBE_TIMEOUT_MS = 12_000;

class HlsContentHealthService {
  async probe(
    slug: string,
    mode: StreamOutputMode = 'blueprint'
  ): Promise<HlsContentHealthResult> {
    const segmentPath = newestSegmentInVariant(slug, mode);
    if (!segmentPath || !fs.existsSync(segmentPath)) {
      return {
        status: 'missing',
        segmentPath: null,
        segmentSize: null,
        blackDuration: 0,
      };
    }

    let segmentSize: number;
    try {
      segmentSize = fs.statSync(segmentPath).size;
    } catch (error) {
      return {
        status: 'missing',
        segmentPath,
        segmentSize: null,
        blackDuration: 0,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const args = [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'info',
      '-threads',
      '1',
      '-i',
      segmentPath,
      '-map',
      '0:v:0',
      '-vf',
      `blackdetect=d=${BLACK_DURATION_SECONDS}:pix_th=${BLACK_PIXEL_THRESHOLD}:pic_th=${BLACK_PICTURE_RATIO}`,
      '-an',
      '-f',
      'null',
      '-',
    ];

    return new Promise((resolve) => {
      let stderr = '';
      let settled = false;
      let probe: ChildProcess;

      const finish = (result: HlsContentHealthResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      try {
        probe = spawn(env.FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      } catch (error) {
        resolve({
          status: 'invalid',
          segmentPath,
          segmentSize,
          blackDuration: 0,
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      probe.stderr?.on('data', (chunk) => {
        // Six-second probes are small, but cap retained diagnostics anyway.
        stderr = `${stderr}${chunk.toString()}`.slice(-32_000);
      });

      const timer = setTimeout(() => {
        try {
          probe.kill('SIGKILL');
        } catch {
          /* already exited */
        }
        finish({
          status: 'invalid',
          segmentPath,
          segmentSize,
          blackDuration: 0,
          detail: 'content probe timed out',
        });
      }, PROBE_TIMEOUT_MS);

      probe.once('error', (error) => {
        finish({
          status: 'invalid',
          segmentPath,
          segmentSize,
          blackDuration: 0,
          detail: error.message,
        });
      });

      probe.once('close', (code) => {
        const durations = Array.from(stderr.matchAll(/black_duration:([0-9.]+)/g))
          .map((match) => Number(match[1]))
          .filter(Number.isFinite);
        const blackDuration = durations.length > 0 ? Math.max(...durations) : 0;

        if (code !== 0) {
          finish({
            status: 'invalid',
            segmentPath,
            segmentSize,
            blackDuration,
            detail: stderr.slice(-600) || `ffmpeg exited with code ${code}`,
          });
          return;
        }

        finish({
          status: blackDuration >= BLACK_DURATION_SECONDS ? 'black' : 'healthy',
          segmentPath,
          segmentSize,
          blackDuration,
        });
      });
    });
  }
}

export const hlsContentHealthService = new HlsContentHealthService();
