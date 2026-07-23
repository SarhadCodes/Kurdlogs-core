import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import type { LogoBurnConfig } from './overlay.service';

export interface BrandProfileInput {
  name: string;
  logoPath?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  enabled?: boolean;
  watermarkPath?: string | null;
  bugPath?: string | null;
}

function parseBrandBody(raw: Record<string, unknown>): BrandProfileInput {
  const intField = (v: unknown, fallback: number) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const floatField = (v: unknown, fallback: number) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : fallback;
  };
  const boolField = (v: unknown, fallback: boolean) => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return fallback;
  };

  return {
    name: String(raw.name ?? '').trim(),
    ...(raw.logoPath !== undefined ? { logoPath: raw.logoPath ? String(raw.logoPath) : null } : {}),
    x: intField(raw.x, 20),
    y: intField(raw.y, 20),
    width: intField(raw.width, 200),
    height: intField(raw.height, 200),
    opacity: floatField(raw.opacity, 1),
    enabled: boolField(raw.enabled, true),
    ...(raw.watermarkPath !== undefined
      ? { watermarkPath: raw.watermarkPath ? String(raw.watermarkPath) : null }
      : {}),
    ...(raw.bugPath !== undefined ? { bugPath: raw.bugPath ? String(raw.bugPath) : null } : {}),
  };
}

class BrandProfileService {
  async getAll() {
    return prisma.brandProfile.findMany({ orderBy: { name: 'asc' } });
  }

  async getById(id: string) {
    const row = await prisma.brandProfile.findUnique({ where: { id } });
    if (!row) throw new AppError('Brand profile not found', 404);
    return row;
  }

  async create(data: BrandProfileInput | Record<string, unknown>) {
    const parsed = parseBrandBody(data as Record<string, unknown>);
    if (!parsed.name) throw new AppError('Name is required', 400);
    return prisma.brandProfile.create({
      data: {
        name: parsed.name,
        logoPath: parsed.logoPath ?? null,
        x: parsed.x ?? 20,
        y: parsed.y ?? 20,
        width: parsed.width ?? 200,
        height: parsed.height ?? 200,
        opacity: parsed.opacity ?? 1,
        enabled: parsed.enabled ?? true,
        watermarkPath: parsed.watermarkPath ?? null,
        bugPath: parsed.bugPath ?? null,
      },
    });
  }

  async update(id: string, data: Partial<BrandProfileInput> | Record<string, unknown>) {
    await this.getById(id);
    const raw = data as Record<string, unknown>;
    const parsed = parseBrandBody(raw);
    return prisma.brandProfile.update({
      where: { id },
      data: {
        ...(raw.name !== undefined ? { name: parsed.name } : {}),
        ...(raw.logoPath !== undefined ? { logoPath: parsed.logoPath ?? null } : {}),
        ...(raw.x !== undefined ? { x: parsed.x } : {}),
        ...(raw.y !== undefined ? { y: parsed.y } : {}),
        ...(raw.width !== undefined ? { width: parsed.width } : {}),
        ...(raw.height !== undefined ? { height: parsed.height } : {}),
        ...(raw.opacity !== undefined ? { opacity: parsed.opacity } : {}),
        ...(raw.enabled !== undefined ? { enabled: parsed.enabled } : {}),
        ...(raw.watermarkPath !== undefined ? { watermarkPath: parsed.watermarkPath ?? null } : {}),
        ...(raw.bugPath !== undefined ? { bugPath: parsed.bugPath ?? null } : {}),
      },
    });
  }

  async delete(id: string) {
    await this.getById(id);
    await prisma.brandProfile.delete({ where: { id } });
    return { message: 'Brand profile deleted' };
  }

  /** Convert DB row → logo burn config for FFmpeg. */
  toLogoConfig(profile: {
    logoPath: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    enabled: boolean;
  }): LogoBurnConfig | null {
    if (!profile.enabled || !profile.logoPath) return null;
    return {
      enabled: true,
      path: profile.logoPath,
      x: profile.x,
      y: profile.y,
      width: profile.width,
      height: profile.height,
      opacity: profile.opacity,
    };
  }
}

export const brandProfileService = new BrandProfileService();
