import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { ffmpegService } from './ffmpeg.service';
import { logger } from '../utils/logger';

export interface LogoBurnConfig {
  enabled?: boolean;
  path?: string;
  imagePath?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
}

const FONT_CANDIDATES = [
  '/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
];

class OverlayService {
  async getOverlaysForChannel(channelId: string) {
    return await prisma.overlay.findMany({ where: { channelId } });
  }

  async createOverlay(channelId: string, data: any) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (
      channel?.isPlaylistChannel &&
      (data.type === 'LOGO' || data.type === 'WATERMARK')
    ) {
      throw new AppError(
        'Playlist channels cannot use runtime logo/watermark overlays. Apply branding during upload via Brand Profiles.',
        400
      );
    }

    const overlay = await prisma.overlay.create({
      data: {
        channelId,
        type: data.type,
        config: data.config,
        position: data.position || 'custom',
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
    });

    await this.restartChannelIfRunning(channelId);
    return overlay;
  }

  async updateOverlay(id: string, data: any) {
    const existing = await prisma.overlay.findUnique({ where: { id } });
    if (!existing) throw new AppError('Overlay not found', 404);

    const updateData: any = { ...data };
    if (data.config && existing.config) {
      updateData.config = {
        ...(existing.config as Record<string, unknown>),
        ...(data.config as Record<string, unknown>),
      };
    }

    const overlay = await prisma.overlay.update({
      where: { id },
      data: updateData,
    });

    await this.restartChannelIfRunning(overlay.channelId);
    return overlay;
  }

  async deleteOverlay(id: string) {
    const overlay = await prisma.overlay.findUnique({ where: { id } });
    if (!overlay) throw new AppError('Overlay not found', 404);

    await prisma.overlay.delete({ where: { id } });
    await this.restartChannelIfRunning(overlay.channelId);
    return { message: 'Overlay deleted' };
  }

  private async restartChannelIfRunning(channelId: string) {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { transcodingProfile: true, overlays: true, playlist: true },
    });
    if (
      channel &&
      (channel.status === 'ONLINE' || channel.status === 'STARTING' || channel.status === 'ERROR')
    ) {
      await ffmpegService.restartStream(channelId, channel);
    }
  }

  private getActiveOverlays(overlays: any[]): any[] {
    return overlays.filter((o) => {
      if (!o.isActive) return false;
      if (o.type === 'LOGO' || o.type === 'WATERMARK') {
        const imagePath = this.getImagePath(o.config);
        if (!imagePath) {
          logger.warn(`Overlay ${o.id} (${o.type}) has no image path`);
          return false;
        }
        if (!fs.existsSync(imagePath)) {
          logger.warn(`Overlay image not found: ${imagePath}`);
          return false;
        }
      }
      if (o.type === 'SCROLLING_TEXT') {
        const text = (o.config as any)?.text;
        return typeof text === 'string' && text.trim().length > 0;
      }
      return true;
    });
  }

  async getOverlayInputs(overlays: any[]): Promise<string[]> {
    const inputs: string[] = [];
    for (const overlay of this.getActiveOverlays(overlays)) {
      if (overlay.type === 'LOGO' || overlay.type === 'WATERMARK') {
        const imagePath = this.getImagePath(overlay.config);
        // Loop static images for the full stream duration (required for overlay filter).
        inputs.push('-loop', '1', '-framerate', '24', '-i', imagePath);
      }
    }
    return inputs;
  }

  /** Playlist streams use per-video burned logos — skip runtime logo/watermark filters. */
  getPlaylistStreamOverlays(overlays: any[]): any[] {
    return (overlays || []).filter(
      (o) => o.isActive && o.type !== 'LOGO' && o.type !== 'WATERMARK'
    );
  }

  resolveImagePath(config: LogoBurnConfig | Record<string, unknown>): string {
    return this.getImagePath(config);
  }

  /** filter_complex for baking a static logo into a normalized 720p file. */
  buildLogoBurnFilterComplex(
    logoConfig: LogoBurnConfig,
    width: number,
    height: number,
    preNormalized = false,
    useSetpts = true,
    overlayShortest = false
  ): string {
    const x = this.resolveX(logoConfig);
    const y = this.resolveY(logoConfig);
    const w = Math.max(1, Math.round(Number(logoConfig.width) || 200));
    const h = Math.max(1, Math.round(Number(logoConfig.height) || 200));
    const opacity =
      logoConfig.opacity != null
        ? Math.min(1, Math.max(0, Number(logoConfig.opacity)))
        : 1;

    const pts = useSetpts ? ',setpts=PTS-STARTPTS' : '';
    const base = preNormalized
      ? `[0:v]fps=24${pts},format=yuv420p[base]`
      : `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=24${pts},format=yuv420p[base]`;

    let logoChain = `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba`;
    let logoLabel = '[logo]';
    if (opacity < 1) {
      logoChain += `[logo_s];[logo_s]colorchannelmixer=aa=${opacity.toFixed(3)}[logo]`;
    } else {
      logoChain += '[logo]';
    }

    const shortestOpt = overlayShortest ? ':shortest=1' : '';
    return `${base};${logoChain};[base]${logoLabel}overlay=${x}:${y}${shortestOpt}:format=auto[vout]`;
  }

  private getImagePath(config: any): string {
    const raw = String(config?.path || config?.imagePath || '').trim();
    if (!raw) return '';
    if (path.isAbsolute(raw)) return raw;
    // Paths like "logos/foo.png" or "/uploads/logos/foo.png" → under UPLOADS_DIR in Docker.
    const normalized = raw.replace(/^[/\\]+uploads[/\\]/i, '').replace(/^[/\\]+/, '');
    return path.join(env.UPLOADS_DIR, normalized);
  }

  async buildFilterComplex(overlays: any[]): Promise<string | null> {
    const activeOverlays = this.getActiveOverlays(overlays);
    if (activeOverlays.length === 0) return null;

    const parts: string[] = [];
    let currentInput = '[0:v]';
    let imageInputIndex = 1;

    for (let i = 0; i < activeOverlays.length; i++) {
      const overlay = activeOverlays[i];
      const config = overlay.config as Record<string, any>;
      const isLast = i === activeOverlays.length - 1;
      const outputName = isLast ? '[outv]' : `[v${i + 1}]`;
      const scheduleEnable = this.buildScheduleEnable(config);
      const drawTextAlpha = this.buildDrawTextAlpha(config);

      if (overlay.type === 'LOGO' || overlay.type === 'WATERMARK') {
        const x = this.resolveX(config);
        const y = this.resolveY(config);
        const w = Math.max(1, Math.round(config.width || 200));
        const h = Math.max(1, Math.round(config.height || 200));
        const ol = `ol${imageInputIndex}`;
        const opacity =
          overlay.type === 'WATERMARK' && config.opacity != null
            ? Math.min(1, Math.max(0, Number(config.opacity)))
            : 1;

        parts.push(
          `[${imageInputIndex}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba[${ol}s]`
        );

        const imgLabel = opacity < 1 ? ol : `${ol}s`;
        if (opacity < 1) {
          parts.push(`[${ol}s]colorchannelmixer=aa=${opacity.toFixed(3)}[${ol}]`);
        }

        parts.push(
          `${currentInput}[${imgLabel}]overlay=${x}:${y}:format=auto:eof_action=repeat:shortest=0${scheduleEnable}${outputName}`
        );
        imageInputIndex++;
      } else if (overlay.type === 'SCROLLING_TEXT') {
        const text = this.escapeDrawText(String(config.text || ''));
        const size = Math.max(8, Math.round(config.fontSize || 24));
        const color = this.normalizeFontColor(config.fontColor || 'white');
        const speed = Math.max(1, Math.round(config.speed || 50));
        const y = config.y != null ? Math.round(config.y) : 20;
        const font = this.ffmpegFontPath();

        parts.push(
          `${currentInput}drawtext=fontfile=${font}:text='${text}':fontsize=${size}:fontcolor=${color}:box=1:boxcolor=0x00000099:boxborderw=4:x=w-mod(t*${speed}\\,w+tw):y=${y}${drawTextAlpha}${scheduleEnable}${outputName}`
        );
      } else if (overlay.type === 'LIVE_BADGE') {
        const x = this.resolveX(config);
        const y = this.resolveY(config);
        const size = Math.max(8, Math.round(config.fontSize || 24));
        const font = this.ffmpegFontPath();

        parts.push(
          `${currentInput}drawtext=fontfile=${font}:text='LIVE':fontsize=${size}:fontcolor=white:box=1:boxcolor=red@0.85:boxborderw=6:x=${x}:y=${y}${drawTextAlpha}${scheduleEnable}${outputName}`
        );
      } else if (overlay.type === 'CLOCK') {
        const x = this.resolveX(config);
        const y = this.resolveY(config);
        const size = Math.max(8, Math.round(config.fontSize || 24));
        const color = this.normalizeFontColor(config.fontColor || 'white');
        const font = this.ffmpegFontPath();
        // % must be written as \% in -filter_complex or the graph parser eats %{...} / %H / %M.
        const clockText = this.escapeFilterGraphPercent('%H:%M:%S');

        parts.push(
          `${currentInput}drawtext=fontfile=${font}:expansion=strftime:basetime=0:text='${clockText}':fontsize=${size}:fontcolor=${color}:box=1:boxcolor=0x00000099:boxborderw=4:x=${x}:y=${y}${drawTextAlpha}${scheduleEnable}${outputName}`
        );
      }

      currentInput = outputName;
    }

    const filterStr = parts.join(';');
    logger.info(`Built filter_complex: ${filterStr}`);
    return filterStr;
  }

  /** Escape % for -filter_complex (drawtext still receives strftime codes). */
  private escapeFilterGraphPercent(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/%/g, '\\%');
  }

  private escapeDrawText(text: string): string {
    return this.escapeFilterGraphPercent(text)
      .replace(/'/g, '\u2019')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
  }

  /** FFmpeg drawtext: names, or 0xRRGGBBAA from #hex. */
  private normalizeFontColor(color: string): string {
    const c = String(color || 'white').trim();
    if (!c) return 'white';
    if (!c.startsWith('#')) {
      if (c.startsWith('0x')) return c;
      return c;
    }
    let hex = c.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
    if (hex.length === 6) hex += 'FF';
    return `0x${hex.toUpperCase()}`;
  }

  private resolveFontFile(): string {
    for (const candidate of FONT_CANDIDATES) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return FONT_CANDIDATES[0];
  }

  private ffmpegFontPath(): string {
    return this.resolveFontFile().replace(/:/g, '\\:').replace(/'/g, "\\'");
  }

  private resolveX(config: any): string {
    if (config.x != null && !Number.isNaN(Number(config.x))) {
      return String(Math.round(Number(config.x)));
    }
    return '20';
  }

  private resolveY(config: any): string {
    if (config.y != null && !Number.isNaN(Number(config.y))) {
      return String(Math.round(Number(config.y)));
    }
    return '20';
  }

  /**
   * Optional per-overlay schedule:
   * - showEveryMinutes: cycle length in minutes
   * - showForSeconds: visible duration at the start of each cycle
   */
  private buildScheduleEnable(config: Record<string, any>): string {
    const everyMinutes = Number(config?.showEveryMinutes);
    const showForSeconds = Number(config?.showForSeconds);
    if (!Number.isFinite(everyMinutes) || !Number.isFinite(showForSeconds)) return '';
    if (everyMinutes <= 0 || showForSeconds <= 0) return '';

    const periodSeconds = Math.max(1, Math.round(everyMinutes * 60));
    const durationSeconds = Math.max(1, Math.min(Math.round(showForSeconds), periodSeconds));
    return `:enable='between(mod(t\\,${periodSeconds})\\,0\\,${durationSeconds})'`;
  }

  /**
   * Fade-in / fade-out for drawtext-based overlays inside each schedule window.
   * Requires showEveryMinutes + showForSeconds to be set.
   */
  private buildDrawTextAlpha(config: Record<string, any>): string {
    const everyMinutes = Number(config?.showEveryMinutes);
    const showForSeconds = Number(config?.showForSeconds);
    if (!Number.isFinite(everyMinutes) || !Number.isFinite(showForSeconds)) return '';
    if (everyMinutes <= 0 || showForSeconds <= 0) return '';

    const periodSeconds = Math.max(1, Math.round(everyMinutes * 60));
    const durationSeconds = Math.max(1, Math.min(Math.round(showForSeconds), periodSeconds));
    const fadeIn = Math.max(0, Number(config?.fadeInSeconds) || 0);
    const fadeOut = Math.max(0, Number(config?.fadeOutSeconds) || 0);
    if (fadeIn <= 0 && fadeOut <= 0) return '';

    const inSec = Math.min(fadeIn, durationSeconds);
    const outSec = Math.min(fadeOut, durationSeconds);
    const outStart = Math.max(0, durationSeconds - outSec);

    // alpha='if(lt(mod(t,P),in),mod(t,P)/in,if(gt(mod(t,P),outStart),(D-mod(t,P))/out,1))'
    const modExpr = `mod(t\\,${periodSeconds})`;
    const inExpr =
      inSec > 0 ? `if(lt(${modExpr}\\,${inSec})\\,${modExpr}/${inSec}\\,` : '';
    const outExpr =
      outSec > 0
        ? `if(gt(${modExpr}\\,${outStart})\\,(${durationSeconds}-${modExpr})/${outSec}\\,1)`
        : '1';
    const expr = `${inExpr}${outExpr}${inSec > 0 ? ')' : ''}`;
    return `:alpha='${expr}'`;
  }
}

export const overlayService = new OverlayService();
