import { spawn } from 'child_process';
import { env } from '../config/env';
import { logger } from './logger';

export interface RtmpProbeOptions {
  /** ffprobe -rw_timeout in microseconds (default 15s) */
  rwTimeoutUs?: number;
  /** Hard kill if probe exceeds this (default 12s) */
  killAfterMs?: number;
  /** Require a video stream in ffprobe output */
  requireVideo?: boolean;
  /** Label for structured logs */
  context?: string;
}

const DEFAULT_RW_TIMEOUT_US = 15_000_000;
const DEFAULT_KILL_AFTER_MS = 12_000;

function ffprobePath(): string {
  return env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
}

/**
 * Probe whether an RTMP URL is readable as a player (not just publishing on nginx stat).
 * nginx bw_in can be > 0 before the stream accepts play subscribers — this confirms play readiness.
 */
export function probeRtmpPlayable(url: string, options?: RtmpProbeOptions): Promise<boolean> {
  const rwTimeoutUs = options?.rwTimeoutUs ?? DEFAULT_RW_TIMEOUT_US;
  const killAfterMs = options?.killAfterMs ?? DEFAULT_KILL_AFTER_MS;
  const requireVideo = options?.requireVideo ?? true;
  const context = options?.context ?? 'probe';

  return new Promise((resolve) => {
    const proc = spawn(ffprobePath(), [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      '-rw_timeout',
      String(rwTimeoutUs),
      url,
    ]);

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      logger.debug(`[MCR_RTMP_PROBE] context=${context} url=${url} result=timeout killAfterMs=${killAfterMs}`);
      resolve(false);
    }, killAfterMs);

    let output = '';
    proc.stdout.on('data', (d) => {
      output += d.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const ok = code === 0 && (!requireVideo || output.includes('video'));
      logger.debug(
        `[MCR_RTMP_PROBE] context=${context} url=${url} exitCode=${code ?? 'null'} ` +
          `hasVideo=${output.includes('video')} result=${ok}`
      );
      resolve(ok);
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Poll until RTMP play succeeds or timeout. Used before program encoder start. */
export async function waitForRtmpPlayable(
  url: string,
  timeoutMs: number,
  options?: Omit<RtmpProbeOptions, 'context'> & { context?: string }
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const context = options?.context ?? 'wait';
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const ok = await probeRtmpPlayable(url, { ...options, context: `${context}#${attempt}` });
    if (ok) {
      logger.info(
        `[MCR_RTMP_PROBE] context=${context} url=${url} ready=true attempt=${attempt} ` +
          `elapsedMs=${timeoutMs - (deadline - Date.now())}`
      );
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const final = await probeRtmpPlayable(url, { ...options, context: `${context}#final` });
  logger.warn(
    `[MCR_RTMP_PROBE] context=${context} url=${url} ready=${final} attempts=${attempt} timeoutMs=${timeoutMs}`
  );
  return final;
}
