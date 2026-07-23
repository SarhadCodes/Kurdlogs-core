import fs from 'fs';
import { spawn } from 'child_process';
import { env } from '../config/env';

interface CacheEntry {
  mtimeMs: number;
  durationSec: number;
}

const durationCache = new Map<string, CacheEntry>();

function ffprobePath(): string {
  return env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
}

function probeDurationUncached(filePath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const probe = spawn(ffprobePath(), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    let output = '';
    probe.stdout.on('data', (d) => {
      output += d.toString();
    });
    probe.on('close', (code) => {
      if (code === 0) {
        const dur = parseFloat(output.trim());
        resolve(Number.isFinite(dur) && dur > 0 ? dur : undefined);
      } else {
        resolve(undefined);
      }
    });
    probe.on('error', () => resolve(undefined));
  });
}

/** Cached ffprobe duration — used so cursor timing matches actual FFmpeg playback. */
export async function probeMediaDurationSec(filePath: string): Promise<number | undefined> {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  try {
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    const cached = durationCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.durationSec;

    const durationSec = await probeDurationUncached(filePath);
    if (durationSec != null) {
      durationCache.set(filePath, { mtimeMs, durationSec });
    }
    return durationSec;
  } catch {
    return undefined;
  }
}

export function clearMediaDurationCache(filePath?: string): void {
  if (filePath) durationCache.delete(filePath);
  else durationCache.clear();
}

/** True when ffprobe finds at least one audio stream in a local media file. */
export async function probeMediaHasAudio(filePath: string): Promise<boolean> {
  if (!filePath || !fs.existsSync(filePath)) return false;
  return new Promise((resolve) => {
    const probe = spawn(ffprobePath(), [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-select_streams',
      'a',
      filePath,
    ]);
    let output = '';
    probe.stdout.on('data', (d) => {
      output += d.toString();
    });
    probe.on('close', (code) => {
      if (code !== 0 || !output) {
        resolve(false);
        return;
      }
      try {
        const data = JSON.parse(output) as { streams?: Array<{ codec_type?: string }> };
        resolve((data.streams || []).some((s) => s.codec_type === 'audio'));
      } catch {
        resolve(false);
      }
    });
    probe.on('error', () => resolve(false));
  });
}

/** Parse `file '...'` lines from an ffconcat playlist. */
export function parseConcatMediaPaths(concatPath: string): string[] {
  if (!concatPath || !fs.existsSync(concatPath)) return [];
  try {
    const content = fs.readFileSync(concatPath, 'utf8');
    const paths: string[] = [];
    for (const match of content.matchAll(/^file\s+'((?:\\'|[^'])*)'/gm)) {
      paths.push(match[1].replace(/\\'/g, "'"));
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * True when any concat entry has audio.
 * If no entries are readable, returns true so playback keeps `0:a?` instead of forcing silence.
 */
export async function probeConcatHasAudio(concatPath: string): Promise<boolean> {
  const paths = parseConcatMediaPaths(concatPath);
  if (paths.length === 0) return true;

  let checked = 0;
  for (const mediaPath of paths) {
    if (!fs.existsSync(mediaPath)) continue;
    checked++;
    if (await probeMediaHasAudio(mediaPath)) return true;
  }

  return checked > 0 ? false : true;
}
