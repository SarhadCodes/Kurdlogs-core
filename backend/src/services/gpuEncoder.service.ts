import { execSync } from 'child_process';
import fs from 'fs';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type VideoCodecId = 'libx264' | 'h264_nvenc' | 'h264_qsv' | 'h264_vaapi';

export interface VideoEncoderConfig {
  codec: VideoCodecId;
  /** Pixel format for the last filter stage before encode */
  pixelFormat: 'yuv420p' | 'nv12';
  preset: string;
  label: string;
}

/** Minimal channel shape for encoder resolution (matches Prisma transcodingProfile). */
export interface ChannelEncoderContext {
  transcodingProfile?: {
    videoCodec?: string;
    preset?: string;
  } | null;
}

interface EffectiveEncoders {
  nvenc: boolean;
  qsv: boolean;
  vaapi: boolean;
}

class GpuEncoderService {
  private probed = false;
  /** FFmpeg binary lists these encoders (may be true without working hardware). */
  private codecInFfmpeg = { nvenc: false, qsv: false, vaapi: false };
  private effective: EffectiveEncoders = { nvenc: false, qsv: false, vaapi: false };

  probe(): void {
    if (this.probed) return;
    this.probed = true;

    try {
      const out = execSync(`"${env.FFMPEG_PATH}" -hide_banner -encoders`, {
        encoding: 'utf8',
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.codecInFfmpeg.nvenc = /\bh264_nvenc\b/.test(out);
      this.codecInFfmpeg.qsv = /\bh264_qsv\b/.test(out);
      this.codecInFfmpeg.vaapi = /\bh264_vaapi\b/.test(out);
    } catch (err) {
      logger.warn('Could not probe FFmpeg encoders; using CPU (libx264) only.', err);
    }

    this.effective = {
      nvenc: this.codecInFfmpeg.nvenc && this.nvidiaRuntimeReady(),
      qsv: this.codecInFfmpeg.qsv && this.intelQsvRuntimeReady(),
      vaapi: this.codecInFfmpeg.vaapi && this.vaapiRuntimeReady(),
    };

    logger.info(
      `Video encoders — FFmpeg: nvenc=${this.codecInFfmpeg.nvenc} qsv=${this.codecInFfmpeg.qsv} vaapi=${this.codecInFfmpeg.vaapi}; ` +
        `runtime: nvenc=${this.effective.nvenc} qsv=${this.effective.qsv} vaapi=${this.effective.vaapi} (mode=${env.FFMPEG_ENCODER_MODE})`
    );

    if (this.codecInFfmpeg.qsv && !this.effective.qsv) {
      logger.warn(
        'FFmpeg includes h264_qsv but Intel QuickSync is not usable in this container (no /dev/dri or MFX). Using CPU for auto mode.'
      );
    }
    if (this.codecInFfmpeg.nvenc && !this.effective.nvenc) {
      logger.warn(
        'FFmpeg includes h264_nvenc but NVIDIA is not usable here. Use docker-compose.gpu.yml on a GPU VPS or FFMPEG_ENCODER_MODE=cpu.'
      );
    }
  }

  private nvidiaRuntimeReady(): boolean {
    try {
      execSync('nvidia-smi -L', {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  private driRenderNode(): string {
    if (fs.existsSync(env.VAAPI_DEVICE)) return env.VAAPI_DEVICE;
    if (fs.existsSync('/dev/dri/renderD128')) return '/dev/dri/renderD128';
    return env.VAAPI_DEVICE;
  }

  private intelQsvRuntimeReady(): boolean {
    const node = this.driRenderNode();
    return fs.existsSync(node);
  }

  private vaapiRuntimeReady(): boolean {
    return this.intelQsvRuntimeReady();
  }

  getStatus() {
    this.probe();
    return {
      mode: env.FFMPEG_ENCODER_MODE,
      ffmpegCodecs: { ...this.codecInFfmpeg },
      runtimeAvailable: { ...this.effective },
      activeCodec: this.resolveForChannel().codec,
      activeLabel: this.resolveForChannel().label,
      vaapiDevice: this.driRenderNode(),
    };
  }

  /** Pick encoder: env mode → profile videoCodec → auto (runtime HW only) → libx264 */
  resolveForChannel(channel?: ChannelEncoderContext | null): VideoEncoderConfig {
    this.probe();
    const { nvenc: useNvenc, qsv: useQsv, vaapi: useVaapi } = this.effective;

    const mode = env.FFMPEG_ENCODER_MODE;
    const profileCodec = (channel?.transcodingProfile?.videoCodec || '').toLowerCase();

    const nvenc = (): VideoEncoderConfig => ({
      codec: 'h264_nvenc',
      pixelFormat: 'nv12',
      preset: env.NVENC_PRESET,
      label: 'NVIDIA NVENC (GPU)',
    });

    const qsv = (): VideoEncoderConfig => ({
      codec: 'h264_qsv',
      pixelFormat: 'nv12',
      preset: 'medium',
      label: 'Intel QuickSync (GPU)',
    });

    const vaapi = (): VideoEncoderConfig => ({
      codec: 'h264_vaapi',
      pixelFormat: 'nv12',
      preset: 'medium',
      label: 'VAAPI (GPU)',
    });

    const cpu = (): VideoEncoderConfig => ({
      codec: 'libx264',
      pixelFormat: 'yuv420p',
      preset: channel?.transcodingProfile?.preset || 'ultrafast',
      label: 'CPU (libx264)',
    });

    const wantsNvenc = mode === 'nvenc' || profileCodec.includes('nvenc');
    const wantsQsv = mode === 'qsv' || profileCodec.includes('qsv');
    const wantsVaapi = mode === 'vaapi' || profileCodec.includes('vaapi');

    if (wantsNvenc && !useNvenc) {
      logger.warn('NVENC requested but GPU encoder is not runtime-ready — using libx264 (CPU).');
      return cpu();
    }
    if (wantsQsv && !useQsv) {
      logger.warn('QuickSync requested but not runtime-ready — using libx264 (CPU).');
      return cpu();
    }
    if (wantsVaapi && !useVaapi) {
      logger.warn('VAAPI requested but not runtime-ready — using libx264 (CPU).');
      return cpu();
    }

    if (mode === 'cpu' || profileCodec === 'libx264' || profileCodec === 'x264') {
      return cpu();
    }

    if ((mode === 'nvenc' || profileCodec.includes('nvenc')) && useNvenc) return nvenc();
    if ((mode === 'qsv' || profileCodec.includes('qsv')) && useQsv) return qsv();
    if ((mode === 'vaapi' || profileCodec.includes('vaapi')) && useVaapi) return vaapi();

    if (mode === 'auto') {
      if (useNvenc) return nvenc();
      if (useQsv) return qsv();
      if (useVaapi) return vaapi();
    }

    return cpu();
  }

  /** Device flags that must appear before inputs (VAAPI). */
  prependDeviceArgs(args: string[], encoder: VideoEncoderConfig): void {
    if (encoder.codec === 'h264_vaapi') {
      args.unshift('-vaapi_device', this.driRenderNode());
    }
  }

  appendVideoEncodeArgs(
    args: string[],
    encoder: VideoEncoderConfig,
    bitrate: { b: string; max: string; buf: string },
    gop: number,
    streamIndex?: number
  ): void {
    const k = (name: string) => (streamIndex === undefined ? `-${name}` : `-${name}:v:${streamIndex}`);

    if (encoder.codec === 'h264_nvenc') {
      args.push(
        k('c:v'),
        'h264_nvenc',
        k('preset'),
        encoder.preset,
        k('rc'),
        'vbr',
        k('tune'),
        'hq',
        k('b:v'),
        bitrate.b,
        k('maxrate'),
        bitrate.max,
        k('bufsize'),
        bitrate.buf,
        k('g'),
        String(gop),
        k('keyint_min'),
        String(gop)
      );
      return;
    }

    if (encoder.codec === 'h264_qsv') {
      args.push(
        k('c:v'),
        'h264_qsv',
        k('preset'),
        encoder.preset,
        k('b:v'),
        bitrate.b,
        k('maxrate'),
        bitrate.max,
        k('bufsize'),
        bitrate.buf,
        k('g'),
        String(gop),
        k('keyint_min'),
        String(gop)
      );
      return;
    }

    if (encoder.codec === 'h264_vaapi') {
      args.push(
        k('c:v'),
        'h264_vaapi',
        k('b:v'),
        bitrate.b,
        k('maxrate'),
        bitrate.max,
        k('bufsize'),
        bitrate.buf,
        k('g'),
        String(gop),
        k('keyint_min'),
        String(gop)
      );
      return;
    }

    args.push(
      k('c:v'),
      'libx264',
      k('preset'),
      encoder.preset,
      k('b:v'),
      bitrate.b,
      k('maxrate'),
      bitrate.max,
      k('bufsize'),
      bitrate.buf,
      k('g'),
      String(gop),
      k('keyint_min'),
      String(gop),
      k('sc_threshold'),
      '0'
    );
  }

  /**
   * Multi-bitrate libx264 ladder with one codec declaration (FFmpeg 7 rejects duplicate -c:v:N).
   */
  appendLibx264LadderEncode(
    args: string[],
    rungs: { si: number; br: { b: string; max: string; buf: string }; preset: string }[],
    gop: number
  ): void {
    if (rungs.length === 0) return;
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      rungs[0].preset,
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
      '-sc_threshold',
      '0'
    );
    for (const rung of rungs) {
      args.push(
        `-b:v:${rung.si}`,
        rung.br.b,
        `-maxrate:v:${rung.si}`,
        rung.br.max,
        `-bufsize:v:${rung.si}`,
        rung.br.buf
      );
    }
  }

  measureGpuUtilization(): number {
    try {
      const out = execSync(
        'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits',
        { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const line = out.trim().split('\n')[0];
      const val = parseInt(line, 10);
      return Number.isFinite(val) && val >= 0 ? val : 0;
    } catch {
      return 0;
    }
  }
}

export const gpuEncoderService = new GpuEncoderService();
