import { ingestService, type NormalizeCodecMode } from './ingest.service';
import { prisma } from '../config/database';
import type { LogoBurnConfig } from './overlay.service';

/** Backward-compatible facade — v12 unified pipeline lives in ingest.service. */
class NormalizeService {
  getNormalizedPath(itemId: string) {
    return ingestService.getNormalizedPath(itemId);
  }

  resolveSourcePath(item: { id: string; sourceVideoPath?: string | null; videoPath: string }) {
    return ingestService.resolveSourcePath(item);
  }

  normalizeVideo(
    itemId: string,
    inputPath: string,
    codecMode: NormalizeCodecMode = 'legacy',
    logoConfig?: LogoBurnConfig | null,
    skipBrand?: boolean
  ): void {
    void prisma.playlistItem.findUnique({ where: { id: itemId } }).then((row) => {
      if (!row) return;
      ingestService.enqueueIngest({
        itemId,
        sourcePath: inputPath,
        playlistId: row.playlistId,
        codecMode,
        brandConfig: logoConfig ?? undefined,
        skipBrand: skipBrand ?? !logoConfig?.enabled,
        jobType: logoConfig?.enabled ? 'REBRAND' : 'INGEST',
      });
    });
  }

  async retryItem(itemId: string): Promise<void> {
    const item = await prisma.playlistItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error('Item not found');
    const source = ingestService.resolveSourcePath(item);
    if (!source) throw new Error('Original upload not found — re-upload the video');
    ingestService.enqueueIngest({
      itemId,
      sourcePath: source,
      playlistId: item.playlistId,
      jobType: 'RETRY',
    });
  }

  isProcessing(itemId: string): boolean {
    return ingestService.isProcessing(itemId);
  }
}

export const normalizeService = new NormalizeService();
export type { NormalizeCodecMode };
