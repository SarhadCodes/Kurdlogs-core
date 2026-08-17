import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { monitorService } from './monitor.service';

export type StorageCleanupTarget =
  | 'stream-cache'
  | 'failed-artifacts'
  | 'expired-exports'
  | 'monitoring-history';

interface FileSummary {
  bytes: number;
  fileCount: number;
}

interface CleanupCandidate {
  path: string;
  bytes: number;
}

interface CleanupPreview extends FileSummary {
  id: StorageCleanupTarget;
  label: string;
  description: string;
  rowCount: number;
}

// Capacity changes much more slowly than CPU/RAM. A five-minute cache avoids
// repeatedly walking large media libraries while the page is open.
const REPORT_CACHE_MS = 5 * 60 * 1000;
const STREAM_GRACE_MS = 30 * 60 * 1000;
const FAILED_ARTIFACT_GRACE_MS = 60 * 60 * 1000;
const EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_RETENTION_DAYS = 7;

const CLEANUP_LABELS: Record<StorageCleanupTarget, Pick<CleanupPreview, 'label' | 'description'>> = {
  'stream-cache': {
    label: 'Stale stream cache',
    description: 'Old HLS segments and temporary files that are no longer referenced by a live playlist.',
  },
  'failed-artifacts': {
    label: 'Failed processing files',
    description: 'Output left behind by failed upload and processing jobs. Active and ready media is protected.',
  },
  'expired-exports': {
    label: 'Expired exports',
    description: 'Downloaded log exports older than seven days.',
  },
  'monitoring-history': {
    label: 'Old monitoring history',
    description: 'Stream statistics, logs, and application events older than seven days.',
  },
};

function emptySummary(): FileSummary {
  return { bytes: 0, fileCount: 0 };
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function walkFiles(
  root: string,
  visitor: (filePath: string, stat: fs.Stats) => void | Promise<void>
): Promise<void> {
  let directory: fs.Dir;
  try {
    directory = await fs.promises.opendir(root);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for await (const entry of directory) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walkFiles(entryPath, visitor);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      await visitor(entryPath, await fs.promises.stat(entryPath));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

class StorageService {
  private cachedReport: { createdAt: number; data: any } | null = null;
  private reportPromise: Promise<any> | null = null;

  async getReport(force = false) {
    if (!force && this.cachedReport && Date.now() - this.cachedReport.createdAt < REPORT_CACHE_MS) {
      return this.cachedReport.data;
    }
    if (!force && this.reportPromise) return this.reportPromise;

    this.reportPromise = this.buildReport();
    try {
      const data = await this.reportPromise;
      this.cachedReport = { createdAt: Date.now(), data };
      return data;
    } finally {
      this.reportPromise = null;
    }
  }

  async cleanup(targets: StorageCleanupTarget[]) {
    const uniqueTargets = [...new Set(targets)];
    const allowed = new Set<StorageCleanupTarget>(Object.keys(CLEANUP_LABELS) as StorageCleanupTarget[]);
    if (uniqueTargets.length === 0 || uniqueTargets.some((target) => !allowed.has(target))) {
      throw new Error('Select at least one valid storage cleanup target.');
    }

    const discovery = await this.discoverCleanupCandidates();
    const results: Array<{
      id: StorageCleanupTarget;
      deletedFiles: number;
      freedBytes: number;
      removedRows: number;
      errors: number;
    }> = [];

    for (const target of uniqueTargets) {
      if (target === 'monitoring-history') {
        const removed = await monitorService.cleanOldData(HISTORY_RETENTION_DAYS);
        results.push({
          id: target,
          deletedFiles: 0,
          freedBytes: 0,
          removedRows: removed.stats + removed.streamLogs + removed.appLogs,
          errors: 0,
        });
        continue;
      }

      let deletedFiles = 0;
      let freedBytes = 0;
      let errors = 0;
      for (const candidate of discovery.files[target]) {
        try {
          await fs.promises.unlink(candidate.path);
          deletedFiles += 1;
          freedBytes += candidate.bytes;
        } catch (error: any) {
          if (error?.code !== 'ENOENT') {
            errors += 1;
            logger.warn(`Storage cleanup could not remove ${candidate.path}: ${error?.message || error}`);
          }
        }
      }
      results.push({ id: target, deletedFiles, freedBytes, removedRows: 0, errors });
    }

    const freedBytes = results.reduce((sum, result) => sum + result.freedBytes, 0);
    const deletedFiles = results.reduce((sum, result) => sum + result.deletedFiles, 0);
    const removedRows = results.reduce((sum, result) => sum + result.removedRows, 0);
    logger.info(
      `Storage cleanup completed: ${deletedFiles} files, ${freedBytes} bytes, ${removedRows} monitoring rows.`
    );

    this.cachedReport = null;
    return {
      completedAt: new Date().toISOString(),
      deletedFiles,
      freedBytes,
      removedRows,
      results,
      storage: await this.getReport(true),
    };
  }

  private async buildReport() {
    const [filesystem, appCategories, cleanup] = await Promise.all([
      this.readFilesystem(),
      this.scanApplicationStorage(),
      this.discoverCleanupCandidates(),
    ]);

    const managedBytes = appCategories.reduce((sum, category) => sum + category.bytes, 0);
    const reclaimableBytes = cleanup.previews.reduce((sum, item) => sum + item.bytes, 0);
    const reclaimableFiles = cleanup.previews.reduce((sum, item) => sum + item.fileCount, 0);
    const otherSystemBytes = Math.max(0, filesystem.usedBytes - managedBytes);

    return {
      generatedAt: new Date().toISOString(),
      filesystem,
      application: {
        totalBytes: managedBytes,
        fileCount: appCategories.reduce((sum, category) => sum + category.fileCount, 0),
        categories: appCategories,
        otherSystemBytes,
      },
      cleanup: {
        reclaimableBytes,
        reclaimableFiles,
        targets: cleanup.previews,
      },
    };
  }

  private async readFilesystem() {
    const probePath = fs.existsSync(env.UPLOADS_DIR) ? env.UPLOADS_DIR : process.cwd();
    const stats = await fs.promises.statfs(probePath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bfree) * Number(stats.bsize);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    const availablePercent = totalBytes > 0 ? (availableBytes / totalBytes) * 100 : 0;
    const status = availablePercent <= 5 ? 'CRITICAL' : availablePercent <= 15 ? 'WARNING' : 'HEALTHY';

    return {
      path: probePath,
      totalBytes,
      usedBytes,
      freeBytes,
      availableBytes,
      reservedBytes: Math.max(0, freeBytes - availableBytes),
      usagePercent: round(usagePercent),
      availablePercent: round(availablePercent),
      status,
    };
  }

  private async scanApplicationStorage() {
    const summaries: Record<string, FileSummary> = {
      sourceMedia: emptySummary(),
      normalizedMedia: emptySummary(),
      graphics: emptySummary(),
      streamOutput: emptySummary(),
      exports: emptySummary(),
      otherUploads: emptySummary(),
    };

    await walkFiles(env.UPLOADS_DIR, (filePath, stat) => {
      const relative = path.relative(env.UPLOADS_DIR, filePath);
      const topDirectory = relative.split(path.sep)[0].toLowerCase();
      let key = 'otherUploads';
      if (topDirectory === 'sources' || topDirectory === 'videos') key = 'sourceMedia';
      else if (topDirectory === 'normalized') key = 'normalizedMedia';
      else if (['graphics-cache', 'logos', 'avatars'].includes(topDirectory)) key = 'graphics';
      else if (topDirectory === 'exports') key = 'exports';
      summaries[key].bytes += stat.size;
      summaries[key].fileCount += 1;
    });

    await walkFiles(env.STREAMS_DIR, (_filePath, stat) => {
      summaries.streamOutput.bytes += stat.size;
      summaries.streamOutput.fileCount += 1;
    });

    const metadata: Record<string, { id: string; label: string; color: string }> = {
      sourceMedia: { id: 'source-media', label: 'Source media', color: '#60a5fa' },
      normalizedMedia: { id: 'normalized-media', label: 'Normalized media', color: '#a78bfa' },
      graphics: { id: 'graphics', label: 'Graphics & branding', color: '#34d399' },
      streamOutput: { id: 'stream-output', label: 'Live stream output', color: '#f59e0b' },
      exports: { id: 'exports', label: 'Exports', color: '#fb7185' },
      otherUploads: { id: 'other-uploads', label: 'Other app files', color: '#94a3b8' },
    };

    return Object.entries(summaries).map(([key, summary]) => ({ ...metadata[key], ...summary }));
  }

  private async discoverCleanupCandidates(): Promise<{
    files: Record<Exclude<StorageCleanupTarget, 'monitoring-history'>, CleanupCandidate[]>;
    previews: CleanupPreview[];
  }> {
    const files: Record<Exclude<StorageCleanupTarget, 'monitoring-history'>, CleanupCandidate[]> = {
      'stream-cache': [],
      'failed-artifacts': [],
      'expired-exports': [],
    };
    const now = Date.now();

    const manifestReferences = await this.collectManifestReferences();
    await walkFiles(env.STREAMS_DIR, (filePath, stat) => {
      const extension = path.extname(filePath).toLowerCase();
      const isSegment = extension === '.ts' || extension === '.m4s' || extension === '.aac';
      const isTemporary = ['.tmp', '.part', '.upload'].includes(extension);
      if (!isSegment && !isTemporary) return;
      if (manifestReferences.has(path.resolve(filePath))) return;
      if (now - stat.mtimeMs < STREAM_GRACE_MS) return;
      files['stream-cache'].push({ path: filePath, bytes: stat.size });
    });

    const { protectedPaths, failedPaths } = await this.collectDatabaseFileReferences();
    for (const failedPath of failedPaths) {
      const resolved = path.resolve(failedPath);
      if (!isInside(env.UPLOADS_DIR, resolved) || protectedPaths.has(resolved)) continue;
      try {
        const stat = await fs.promises.stat(resolved);
        if (!stat.isFile() || now - stat.mtimeMs < FAILED_ARTIFACT_GRACE_MS) continue;
        files['failed-artifacts'].push({ path: resolved, bytes: stat.size });
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    const exportsDirectory = path.join(env.UPLOADS_DIR, 'exports');
    await walkFiles(exportsDirectory, (filePath, stat) => {
      if (!isInside(exportsDirectory, filePath)) return;
      if (now - stat.mtimeMs < EXPORT_RETENTION_MS) return;
      files['expired-exports'].push({ path: filePath, bytes: stat.size });
    });

    for (const target of Object.keys(files) as Array<Exclude<StorageCleanupTarget, 'monitoring-history'>>) {
      const seen = new Set<string>();
      files[target] = files[target].filter((candidate) => {
        const resolved = path.resolve(candidate.path);
        if (seen.has(resolved)) return false;
        seen.add(resolved);
        return true;
      });
    }

    const historyThreshold = new Date(now - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const [oldStats, oldStreamLogs, oldAppLogs] = await Promise.all([
      prisma.streamStats.count({ where: { timestamp: { lt: historyThreshold } } }),
      prisma.streamLog.count({ where: { timestamp: { lt: historyThreshold } } }),
      prisma.appLog.count({ where: { createdAt: { lt: historyThreshold } } }),
    ]);

    const previews: CleanupPreview[] = [
      ...Object.entries(files).map(([id, candidates]) => ({
        id: id as StorageCleanupTarget,
        ...CLEANUP_LABELS[id as StorageCleanupTarget],
        bytes: candidates.reduce((sum, candidate) => sum + candidate.bytes, 0),
        fileCount: candidates.length,
        rowCount: 0,
      })),
      {
        id: 'monitoring-history',
        ...CLEANUP_LABELS['monitoring-history'],
        bytes: 0,
        fileCount: 0,
        rowCount: oldStats + oldStreamLogs + oldAppLogs,
      },
    ];

    return { files, previews };
  }

  private async collectManifestReferences(): Promise<Set<string>> {
    const references = new Set<string>();
    await walkFiles(env.STREAMS_DIR, async (filePath) => {
      if (path.extname(filePath).toLowerCase() !== '.m3u8') return;
      let content: string;
      try {
        content = await fs.promises.readFile(filePath, 'utf8');
      } catch {
        return;
      }
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || /^[a-z][a-z0-9+.-]*:\/\//i.test(line)) continue;
        const localPart = line.split('?')[0].split('#')[0];
        const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(localPart));
        if (isInside(env.STREAMS_DIR, resolved)) references.add(resolved);
      }
    });
    return references;
  }

  private async collectDatabaseFileReferences(): Promise<{
    protectedPaths: Set<string>;
    failedPaths: Set<string>;
  }> {
    const [items, jobs, assets, brands, hybridStates, users, overlays, channels, scenes] =
      await Promise.all([
        prisma.playlistItem.findMany({
          select: { status: true, videoPath: true, sourceVideoPath: true, logoConfig: true },
        }),
        prisma.processingJob.findMany({
          select: { status: true, sourcePath: true, outputPath: true },
        }),
        prisma.graphicsAsset.findMany({ select: { path: true } }),
        prisma.brandProfile.findMany({
          select: { logoPath: true, watermarkPath: true, bugPath: true },
        }),
        prisma.hybridChannelState.findMany({ select: { stationIdVideoPath: true } }),
        prisma.user.findMany({ select: { avatarUrl: true } }),
        prisma.overlay.findMany({ select: { config: true } }),
        prisma.channel.findMany({ select: { sourceUrl: true } }),
        prisma.graphicsScene.findMany({ select: { document: true } }),
      ]);

    const protectedPaths = new Set<string>();
    const failedPaths = new Set<string>();
    const addManagedPath = (collection: Set<string>, value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return;
      const raw = value.trim();
      if (/^(https?|rtmps?|srt|udp|tcp|data):/i.test(raw)) return;
      let resolved: string;
      if (raw.startsWith('/uploads/')) resolved = path.join(env.UPLOADS_DIR, raw.slice('/uploads/'.length));
      else if (path.isAbsolute(raw)) resolved = raw;
      else resolved = path.join(env.UPLOADS_DIR, raw);
      resolved = path.resolve(resolved);
      if (isInside(env.UPLOADS_DIR, resolved) || isInside(env.STREAMS_DIR, resolved)) {
        collection.add(resolved);
      }
    };
    const addJsonPaths = (collection: Set<string>, value: unknown) => {
      if (typeof value === 'string') {
        addManagedPath(collection, value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => addJsonPaths(collection, entry));
        return;
      }
      if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach((entry) => addJsonPaths(collection, entry));
      }
    };

    for (const item of items) {
      const target = item.status === 'FAILED' ? failedPaths : protectedPaths;
      addManagedPath(target, item.videoPath);
      addManagedPath(target, item.sourceVideoPath);
      addJsonPaths(target, item.logoConfig);
    }
    for (const job of jobs) {
      const target = job.status === 'FAILED' ? failedPaths : protectedPaths;
      addManagedPath(target, job.sourcePath);
      addManagedPath(target, job.outputPath);
    }
    assets.forEach((asset) => addManagedPath(protectedPaths, asset.path));
    brands.forEach((brand) => {
      addManagedPath(protectedPaths, brand.logoPath);
      addManagedPath(protectedPaths, brand.watermarkPath);
      addManagedPath(protectedPaths, brand.bugPath);
    });
    hybridStates.forEach((state) => addManagedPath(protectedPaths, state.stationIdVideoPath));
    users.forEach((user) => addManagedPath(protectedPaths, user.avatarUrl));
    overlays.forEach((overlay) => addJsonPaths(protectedPaths, overlay.config));
    channels.forEach((channel) => addManagedPath(protectedPaths, channel.sourceUrl));
    scenes.forEach((scene) => addJsonPaths(protectedPaths, scene.document));

    return { protectedPaths, failedPaths };
  }
}

export const storageService = new StorageService();
