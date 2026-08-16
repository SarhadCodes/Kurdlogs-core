import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

function assertSafeSvg(buffer: Buffer): void {
  const text = buffer.toString('utf8');
  const isSvg = /<svg\b/i.test(text);
  const unsafe = /<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*['\"](?:https?:|\/\/|data:)/i.test(text);
  if (!isSvg || unsafe) {
    throw new AppError('SVG assets may not contain scripts, event handlers, embedded data, or external references', 400);
  }
}

class GraphicsAssetService {
  async list() {
    return prisma.graphicsAsset.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async registerUpload(file: Express.Multer.File) {
    if (!ALLOWED.has(file.mimetype)) throw new AppError('Only PNG, JPEG, WebP, and SVG graphics assets are allowed', 400);
    const maxBytes = Math.max(1, env.GRAPHICS_MAX_ASSET_MB) * 1024 * 1024;
    if (file.size <= 0 || file.size > maxBytes) throw new AppError(`Graphics asset exceeds ${env.GRAPHICS_MAX_ASSET_MB} MB limit`, 400);
    const buffer = fs.readFileSync(file.path);
    if (file.mimetype === 'image/svg+xml') assertSafeSvg(buffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const existing = await prisma.graphicsAsset.findUnique({ where: { sha256 } });
    if (existing) {
      if (path.resolve(file.path) !== path.resolve(existing.path)) fs.unlinkSync(file.path);
      return existing;
    }
    return prisma.graphicsAsset.create({
      data: { filename: path.basename(file.originalname), mimeType: file.mimetype, path: file.path, sha256, bytes: file.size },
    });
  }

  /**
   * A graphics logo is looped for every output frame. Cache a small raster
   * derivative once so a phone-sized or camera-sized source image is never
   * decoded and scaled 24 times per second by the live encoder.
   */
  getBroadcastAssetPath(
    asset: { path: string; sha256: string; mimeType: string },
    opacity = 1,
  ): string {
    if (asset.mimeType === 'image/svg+xml') return asset.path;
    const alpha = Math.min(1, Math.max(0, Number(opacity) || 0));
    const cacheDir = path.join(env.UPLOADS_DIR, 'graphics-cache');
    // Apply scene opacity once while creating the cached raster. Applying
    // colorchannelmixer in the live graph costs a full-frame alpha pass for
    // every program frame, even though the logo never changes.
    const opacityKey = Math.round(alpha * 1000);
    const cachePath = path.join(cacheDir, `${asset.sha256}-400-a${opacityKey}.png`);
    if (fs.existsSync(cachePath)) return cachePath;

    fs.mkdirSync(cacheDir, { recursive: true });
    const tempPath = `${cachePath}.tmp.png`;
    const result = spawnSync(
      env.FFMPEG_PATH,
      [
        '-y', '-v', 'error', '-i', asset.path,
        '-frames:v', '1',
        '-vf', alpha < 1
          ? `scale=400:400:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${alpha.toFixed(3)}`
          : 'scale=400:400:force_original_aspect_ratio=decrease',
        '-pix_fmt', 'rgba',
        tempPath,
      ],
      { timeout: 30_000 },
    );

    if (result.status === 0 && fs.existsSync(tempPath)) {
      fs.renameSync(tempPath, cachePath);
      return cachePath;
    }
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return asset.path;
  }
}

export const graphicsAssetService = new GraphicsAssetService();
