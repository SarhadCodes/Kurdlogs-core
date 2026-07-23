import { Request, Response } from 'express';
import { monitorService } from '../services/monitor.service';
import os from 'os';
import { ffmpegService } from '../services/ffmpeg.service';
import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { gpuEncoderService } from '../services/gpuEncoder.service';
import { channelHealthService } from '../services/channelHealth.service';
import { appLogService } from '../services/appLog.service';
import fs from 'fs';

export const getGpuEncoderStatus = async (_req: Request, res: Response) => {
  res.json({ success: true, data: gpuEncoderService.getStatus() });
};

export const getSystemStats = async (_req: Request, res: Response) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = (usedMem / totalMem) * 100;
  const cpuPercent = monitorService.getSystemCpuPercent();
  const activeChannels = ffmpegService.getAllProcesses().size;

  res.json({
    success: true,
    data: {
      cpu: cpuPercent,
      ram: memPercent,
      totalMem,
      usedMem,
      activeChannels,
      uptime: os.uptime(),
    },
  });
};

export const getChannelHealthAll = async (_req: Request, res: Response) => {
  const data = await channelHealthService.getAllChannelHealth();
  res.json({ success: true, data });
};

export const getAppLogs = async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
  const category = req.query.category ? String(req.query.category) : undefined;
  const logs = await appLogService.list({
    limit,
    category: category as any,
  });
  res.json({ success: true, data: logs });
};

export const exportAppLogs = async (_req: Request, res: Response) => {
  const filePath = await appLogService.exportJson();
  res.download(filePath);
};

export const getChannelHealth = async (req: Request, res: Response) => {
  const processInfo = ffmpegService.getProcessInfo(String(req.params.channelId));
  
  res.json({
    success: true,
    data: {
      isProcessRunning: !!processInfo,
      stats: processInfo?.stats || null
    }
  });
};

export const getGlobalLogs = async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const logs = await prisma.streamLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: safeLimit,
  });
  res.json({ success: true, data: logs });
};

export const exportBackup = async (_req: Request, res: Response) => {
  const [
    users,
    transcodingProfiles,
    playlists,
    playlistItems,
    channels,
    overlays,
    tokens,
    boostNodes,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.transcodingProfile.findMany(),
    prisma.playlist.findMany(),
    prisma.playlistItem.findMany(),
    prisma.channel.findMany(),
    prisma.overlay.findMany(),
    prisma.token.findMany(),
    prisma.boostNode.findMany(),
  ]);

  const payload = {
    meta: {
      app: 'kurdlogs-core',
      version: 1,
      exportedAt: new Date().toISOString(),
    },
    data: {
      users,
      transcodingProfiles,
      playlists,
      playlistItems,
      channels,
      overlays,
      tokens,
      boostNodes,
    },
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="kurdlogs-backup-${stamp}.json"`);
  res.send(JSON.stringify(payload, null, 2));
};

export const importBackup = async (req: Request, res: Response) => {
  const backup = req.body?.backup;
  if (!backup?.data) {
    throw new AppError('Invalid backup payload', 400);
  }

  const users: any[] = backup.data.users || [];
  const transcodingProfiles: any[] = backup.data.transcodingProfiles || [];
  const playlists: any[] = backup.data.playlists || [];
  const playlistItems: any[] = backup.data.playlistItems || [];
  const channels: any[] = backup.data.channels || [];
  const overlays: any[] = backup.data.overlays || [];
  const tokens: any[] = backup.data.tokens || [];
  const boostNodes: any[] = backup.data.boostNodes || [];

  await prisma.$transaction(async (tx) => {
    for (const row of users) {
      await tx.user.upsert({
        where: { id: row.id },
        update: {
          username: row.username,
          email: row.email,
          passwordHash: row.passwordHash,
          role: row.role,
          mustChangePassword: row.mustChangePassword,
        },
        create: row,
      });
    }

    for (const row of transcodingProfiles) {
      await tx.transcodingProfile.upsert({
        where: { id: row.id },
        update: row,
        create: row,
      });
    }

    for (const row of playlists) {
      await tx.playlist.upsert({
        where: { id: row.id },
        update: {
          name: row.name,
          isLooping: row.isLooping,
        },
        create: row,
      });
    }

    for (const row of channels) {
      await tx.channel.upsert({
        where: { id: row.id },
        update: {
          name: row.name,
          slug: row.slug,
          sourceUrl: row.sourceUrl,
          sourceType: row.sourceType,
          status: 'OFFLINE',
          transcodingProfileId: row.transcodingProfileId,
          autoReconnect: row.autoReconnect,
          maxReconnectAttempts: row.maxReconnectAttempts,
          reconnectDelay: row.reconnectDelay,
          customFfmpegArgs: row.customFfmpegArgs,
          pid: null,
          outputType: row.outputType,
          enableDvr: row.enableDvr,
          dvrWindowMinutes: row.dvrWindowMinutes,
          isPlaylistChannel: row.isPlaylistChannel,
          playlistId: row.playlistId,
        },
        create: {
          ...row,
          status: 'OFFLINE',
          pid: null,
        },
      });
    }

    for (const row of playlistItems) {
      await tx.playlistItem.upsert({
        where: { id: row.id },
        update: {
          playlistId: row.playlistId,
          videoPath: row.videoPath,
          originalFilename: row.originalFilename,
          position: row.position,
          duration: row.duration,
          status: row.status,
        },
        create: row,
      });
    }

    for (const row of overlays) {
      await tx.overlay.upsert({
        where: { id: row.id },
        update: {
          channelId: row.channelId,
          type: row.type,
          config: row.config,
          isActive: row.isActive,
          position: row.position,
        },
        create: row,
      });
    }

    for (const row of tokens) {
      await tx.token.upsert({
        where: { id: row.id },
        update: {
          channelId: row.channelId,
          token: row.token,
          previousToken: row.previousToken,
          previousTokenValidUntil: row.previousTokenValidUntil,
          expiresAt: row.expiresAt,
          refreshIntervalMinutes: row.refreshIntervalMinutes,
          isActive: row.isActive,
        },
        create: row,
      });
    }

    for (const row of boostNodes) {
      await tx.boostNode.upsert({
        where: { id: row.id },
        update: {
          name: row.name,
          host: row.host,
          port: row.port,
          encode: row.encode,
          stream: row.stream,
          maxChannels: row.maxChannels,
          status: row.status,
          secretKey: row.secretKey,
          notes: row.notes,
          lastSeenAt: row.lastSeenAt,
          workerHostname: row.workerHostname,
          workerVersion: row.workerVersion,
          workerCpu: row.workerCpu,
          workerRam: row.workerRam,
          activeChannels: row.activeChannels ?? 0,
        },
        create: row,
      });
    }
  });

  res.json({ success: true, message: 'Backup imported successfully' });
};
