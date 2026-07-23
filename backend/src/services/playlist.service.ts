import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { ingestService, type NormalizeCodecMode } from './ingest.service';
import { brandResolverService } from './brandResolver.service';
import { type LogoBurnConfig } from './overlay.service';

class PlaylistService {
  private getSourcesDir(): string {
    const dir = path.join(env.UPLOADS_DIR, 'sources');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Copy upload to permanent sources/{itemId}.ext so retry works after Docker redeploys. */
  private archiveSourceFile(itemId: string, uploadPath: string): string {
    if (!fs.existsSync(uploadPath)) {
      throw new AppError('Uploaded video file missing on server — try uploading again', 400);
    }
    const ext = path.extname(uploadPath) || '.mp4';
    const dest = path.join(this.getSourcesDir(), `${itemId}${ext}`);

    // Remove older archive with different extension
    for (const name of fs.readdirSync(this.getSourcesDir())) {
      if (name.startsWith(`${itemId}.`)) {
        try { fs.unlinkSync(path.join(this.getSourcesDir(), name)); } catch { /* ignore */ }
      }
    }

    fs.copyFileSync(uploadPath, dest);
    return dest;
  }

  findArchivedSource(itemId: string): string | null {
    const dir = this.getSourcesDir();
    if (!fs.existsSync(dir)) return null;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(`${itemId}.`)) continue;
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }

  async getAllPlaylists() {
    return await prisma.playlist.findMany({
      include: {
        brandProfile: { select: { id: true, name: true } },
        _count: {
          select: { items: true }
        }
      }
    });
  }

  async getPlaylistById(id: string) {
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        brandProfile: true,
        items: {
          orderBy: { position: 'asc' }
        }
      }
    });
    if (!playlist) throw new AppError('Playlist not found', 404);
    return playlist;
  }

  async createPlaylist(data: any) {
    return await prisma.playlist.create({ data });
  }

  async updatePlaylist(id: string, data: any) {
    return await prisma.playlist.update({
      where: { id },
      data
    });
  }

  async deletePlaylist(id: string) {
    // Delete items first
    await prisma.playlistItem.deleteMany({ where: { playlistId: id } });
    return await prisma.playlist.delete({ where: { id } });
  }

  async addItem(
    playlistId: string,
    videoPath: string,
    originalFilename: string,
    duration?: number,
    normalize: boolean = true,
    normalizeCodec: NormalizeCodecMode = 'legacy',
    brandProfileId?: string | null
  ) {
    if (!fs.existsSync(videoPath)) {
      throw new AppError('Video file not found on server — upload may have failed', 400);
    }

    const itemsCount = await prisma.playlistItem.count({ where: { playlistId } });

    let itemLogoConfig: LogoBurnConfig | null = null;
    if (brandProfileId === 'none') {
      itemLogoConfig = null;
    } else if (brandProfileId) {
      itemLogoConfig = await brandResolverService.resolveForBrandProfileId(brandProfileId);
    }

    const item = await prisma.playlistItem.create({
      data: {
        playlistId,
        videoPath,
        sourceVideoPath: videoPath,
        originalFilename,
        position: itemsCount,
        duration,
        status: normalize ? 'PROCESSING' : 'READY',
        ...(itemLogoConfig ? { logoConfig: itemLogoConfig as object } : {}),
      },
    });

    const archivedPath = this.archiveSourceFile(item.id, videoPath);
    await prisma.playlistItem.update({
      where: { id: item.id },
      data: { sourceVideoPath: archivedPath, videoPath: archivedPath },
    });

    if (normalize) {
      let brand: LogoBurnConfig | null = null;
      if (brandProfileId === 'none') {
        brand = null;
      } else if (itemLogoConfig) {
        brand = itemLogoConfig;
      } else {
        brand = await brandResolverService.resolveForPlaylist(playlistId);
      }
      ingestService.enqueueIngest({
        itemId: item.id,
        sourcePath: archivedPath,
        playlistId,
        codecMode: normalizeCodec,
        brandConfig: brand,
        skipBrand: !brand,
        jobType: 'INGEST',
      });
    } else {
      await this.generateConcatFile(playlistId, false, true, {
        changeType: 'add',
        newMedia: originalFilename,
        itemId: item.id,
      });
    }

    return await prisma.playlistItem.findUnique({ where: { id: item.id } });
  }

  async replaceItem(
    itemId: string,
    newVideoPath: string,
    originalFilename: string,
    brandProfileId?: string | null
  ) {
    const item = await prisma.playlistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('Item not found', 404);

    if (!fs.existsSync(newVideoPath)) {
      throw new AppError('Uploaded video file missing on server — try uploading again', 400);
    }

    const archivedPath = this.archiveSourceFile(itemId, newVideoPath);

    let itemLogoConfig: LogoBurnConfig | null | undefined;
    if (brandProfileId === 'none') {
      itemLogoConfig = null;
    } else if (brandProfileId) {
      itemLogoConfig = await brandResolverService.resolveForBrandProfileId(brandProfileId);
    }

    const updateData: {
      videoPath: string;
      sourceVideoPath: string;
      originalFilename: string;
      status: 'PROCESSING';
      logoBurned: boolean;
      brandApplied: boolean;
      processingError: null;
      logoConfig?: typeof Prisma.DbNull | object;
    } = {
      videoPath: archivedPath,
      sourceVideoPath: archivedPath,
      originalFilename,
      status: 'PROCESSING',
      logoBurned: false,
      brandApplied: false,
      processingError: null,
    };

    if (brandProfileId === 'none') {
      updateData.logoConfig = Prisma.DbNull;
    } else if (brandProfileId && itemLogoConfig) {
      updateData.logoConfig = itemLogoConfig as object;
    }

    await prisma.playlistItem.update({
      where: { id: itemId },
      data: updateData,
    });

    let brand: LogoBurnConfig | null = null;
    if (brandProfileId === 'none') {
      brand = null;
    } else if (itemLogoConfig) {
      brand = itemLogoConfig;
    } else {
      brand = await brandResolverService.resolveForItem(itemId);
    }
    ingestService.enqueueIngest({
      itemId,
      sourcePath: archivedPath,
      playlistId: item.playlistId,
      brandConfig: brand,
      skipBrand: !brand,
      jobType: 'INGEST',
    });

    return await prisma.playlistItem.findUnique({ where: { id: itemId } });
  }

  async removeItem(itemId: string) {
    const item = await prisma.playlistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('Item not found', 404);

    await prisma.playlistItem.delete({ where: { id: itemId } });

    // Reorder remaining items
    const remaining = await prisma.playlistItem.findMany({
      where: { playlistId: item.playlistId },
      orderBy: { position: 'asc' }
    });

    for (let i = 0; i < remaining.length; i++) {
      await prisma.playlistItem.update({
        where: { id: remaining[i].id },
        data: { position: i }
      });
    }

    await this.generateConcatFile(item.playlistId, false, true, {
      changeType: 'delete',
      oldMedia: item.originalFilename,
      itemId,
    });
  }

  async reorderItems(playlistId: string, itemIds: string[]) {
    // Note: In a real production app, this should be a transaction
    for (let i = 0; i < itemIds.length; i++) {
      await prisma.playlistItem.update({
        where: { id: itemIds[i] },
        data: { position: i }
      });
    }

    await this.generateConcatFile(playlistId, false, true, { changeType: 'reorder' });
  }

  getConcatFilePath(playlistId: string): string {
    const playlistDir = path.join(env.STREAMS_DIR, 'playlists');
    if (!fs.existsSync(playlistDir)) fs.mkdirSync(playlistDir, { recursive: true });
    return path.join(playlistDir, `${playlistId}.txt`);
  }

  async generateConcatFile(
    playlistId: string,
    loop: boolean = false,
    restartLive = true,
    mutation?: Omit<import('./blueprintPlaylistSync.service').PlaylistMutationMeta, 'playlistId'>
  ) {
    const playlist = await this.getPlaylistById(playlistId);
    const filePath = this.getConcatFilePath(playlistId);

    const readyItems = playlist.items.filter((item: any) => item.status === 'READY');

    if (readyItems.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (restartLive) {
        await this.restartLiveChannelsForPlaylist(playlistId);
      }
      return;
    }

    let singlePass = 'ffconcat version 1.0\n';
    for (const item of readyItems) {
      const safePath = item.videoPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
      singlePass += `file '${safePath}'\n`;
    }

    let content = singlePass;
    if (loop) {
      const repeats = 9999;
      content = singlePass.repeat(repeats);
    }

    fs.writeFileSync(filePath, content, 'utf8');
    if (restartLive) {
      const { blueprintPlaylistSyncService } = await import('./blueprintPlaylistSync.service');
      await blueprintPlaylistSyncService.handlePlaylistMutation({
        playlistId,
        changeType: mutation?.changeType ?? 'other',
        oldMedia: mutation?.oldMedia,
        newMedia: mutation?.newMedia,
        itemId: mutation?.itemId,
      });
    }
  }

  /** Restart any running channel that reads this playlist (lazy import avoids circular deps). */
  private async restartLiveChannelsForPlaylist(playlistId: string): Promise<void> {
    const { blueprintPlaylistSyncService } = await import('./blueprintPlaylistSync.service');
    await blueprintPlaylistSyncService.handlePlaylistMutation({ playlistId, changeType: 'other' });
  }

  async updateItemLogo(itemId: string, logoConfig: LogoBurnConfig, reburn = true) {
    const item = await prisma.playlistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('Item not found', 404);

    const sourcePath = ingestService.resolveSourcePath(item);
    if (!sourcePath) {
      throw new AppError('Original file missing — click Re-upload on this row and select the video again', 400);
    }

    await prisma.playlistItem.update({
      where: { id: itemId },
      data: {
        logoConfig: logoConfig as object,
        logoBurned: false,
        brandApplied: false,
        status: reburn ? 'PROCESSING' : item.status,
      },
    });

    if (reburn) {
      ingestService.enqueueIngest({
        itemId,
        sourcePath,
        playlistId: item.playlistId,
        brandConfig: logoConfig.enabled ? logoConfig : null,
        skipBrand: !logoConfig.enabled,
        jobType: 'REBRAND',
      });
    }

    return await prisma.playlistItem.findUnique({ where: { id: itemId } });
  }

  async retryNormalize(itemId: string) {
    const item = await prisma.playlistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('Item not found', 404);
    const source = ingestService.resolveSourcePath(item);
    if (!source) {
      throw new AppError('Original file missing — click Re-upload on this row and select the video again', 400);
    }
    const brand = await brandResolverService.resolveForItem(itemId);
    ingestService.enqueueIngest({
      itemId,
      sourcePath: source,
      playlistId: item.playlistId,
      brandConfig: brand,
      skipBrand: !brand,
      jobType: 'RETRY',
    });
    return await prisma.playlistItem.findUnique({ where: { id: itemId } });
  }
}

export const playlistService = new PlaylistService();
