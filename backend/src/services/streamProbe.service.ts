import { spawn } from 'child_process';
import { env } from '../config/env';

export interface StreamProbeResult {
  online: boolean;
  bitrate: number;
  fps: number;
  width: number | null;
  height: number | null;
  resolution: string | null;
  hasAudio: boolean;
  audioCodec: string | null;
  videoCodec: string | null;
}

function ffprobePath(): string {
  return env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
}

export async function probeStream(url: string, timeoutMs = 8000): Promise<StreamProbeResult> {
  const empty: StreamProbeResult = {
    online: false,
    bitrate: 0,
    fps: 0,
    width: null,
    height: null,
    resolution: null,
    hasAudio: false,
    audioCodec: null,
    videoCodec: null,
  };

  return new Promise((resolve) => {
    const proc = spawn(
      ffprobePath(),
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        '-analyzeduration',
        '5000000',
        '-probesize',
        '5000000',
        '-user_agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(empty);
    }, timeoutMs);

    proc.stdout?.on('data', (d) => {
      stdout += d.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout) {
        resolve(empty);
        return;
      }
      try {
        const data = JSON.parse(stdout) as {
          streams?: Array<{
            codec_type?: string;
            width?: number;
            height?: number;
            r_frame_rate?: string;
            bit_rate?: string;
            codec_name?: string;
          }>;
          format?: { bit_rate?: string };
        };
        const video = data.streams?.find((s) => s.codec_type === 'video');
        const audio = data.streams?.find((s) => s.codec_type === 'audio');
        const w = video?.width ?? null;
        const h = video?.height ?? null;
        let fps = 0;
        if (video?.r_frame_rate) {
          const [n, d] = video.r_frame_rate.split('/').map(Number);
          if (d > 0) fps = n / d;
        }
        const bitrate = parseInt(video?.bit_rate ?? data.format?.bit_rate ?? '0', 10);
        resolve({
          online: !!video,
          bitrate: Math.round(bitrate / 1000),
          fps: Math.round(fps * 10) / 10,
          width: w,
          height: h,
          resolution: w && h ? `${w}x${h}` : null,
          hasAudio: !!audio,
          audioCodec: audio?.codec_name ?? null,
          videoCodec: video?.codec_name ?? null,
        });
      } catch {
        resolve(empty);
      }
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(empty);
    });
  });
}

export const HYBRID_TARGET = {
  width: 1280,
  height: 720,
  fps: 24,
  videoCodec: 'h264',
  audioCodec: 'aac',
} as const;

export function matchesHybridTarget(probe: StreamProbeResult): boolean {
  if (!probe.online || !probe.width || !probe.height) return false;
  const fpsOk = Math.abs(probe.fps - HYBRID_TARGET.fps) < 1.5;
  const resOk = probe.width === HYBRID_TARGET.width && probe.height === HYBRID_TARGET.height;
  const vCodecOk = probe.videoCodec === HYBRID_TARGET.videoCodec;
  const aCodecOk =
    !probe.hasAudio ||
    probe.audioCodec === HYBRID_TARGET.audioCodec ||
    probe.audioCodec === 'mp4a';
  return fpsOk && resOk && vCodecOk && aCodecOk;
}
