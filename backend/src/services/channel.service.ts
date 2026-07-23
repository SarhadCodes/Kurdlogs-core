import { prisma } from '../config/database';
import { buildMcrInternalIngestUrl } from '../config/mcrRtmp';
import { generateSlug } from '../utils/helpers';
import { logger } from '../utils/logger';
import { ffmpegService } from './ffmpeg.service';
import { AppError } from '../middleware/errorHandler';

class ChannelService {
  async getAllChannels() {
    return await prisma.channel.findMany({
      include: {
        transcodingProfile: true,
        playlist: true,
        blueprint: true,
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getChannelById(id: string) {
    const channel = await prisma.channel.findUnique({
      where: { id },
      include: {
        transcodingProfile: true,
        overlays: true,
        playlist: true,
        blueprint: true,
      }
    });

    if (!channel) throw new AppError('Channel not found', 404);
    return channel;
  }

  async getChannelBySlug(slug: string) {
    const channel = await prisma.channel.findUnique({
      where: { slug }
    });
    
    if (!channel) throw new AppError('Channel not found', 404);
    return channel;
  }

  async createChannel(data: any) {
    const slug = generateSlug(data.name);
    
    // Check if slug exists
    const existing = await prisma.channel.findUnique({ where: { slug } });
    if (existing) throw new AppError('Channel with similar name already exists', 400);

    const { id, ...createData } = data;

    if (createData.useBlueprint && createData.blueprintId) {
      const blueprint = await prisma.channelBlueprint.findUnique({
        where: { id: createData.blueprintId },
      });
      if (!blueprint) throw new AppError('Blueprint not found', 404);

      createData.isPlaylistChannel = true;
      createData.useBlueprint = true;
      createData.sourceUrl = 'internal-playlist';
      createData.sourceType = createData.sourceType || 'MP4';
      createData.playlistId = null;

      const otherHolder = await prisma.channel.findFirst({
        where: { blueprintId: createData.blueprintId },
      });
      if (otherHolder) {
        await prisma.channel.update({
          where: { id: otherHolder.id },
          data: { blueprintId: null, useBlueprint: false },
        });
      }

      await prisma.channelBlueprint.update({
        where: { id: createData.blueprintId },
        data: { status: 'PUBLISHED' },
      });
    } else if (createData.isPlaylistChannel && !createData.sourceUrl) {
      createData.sourceUrl = 'internal-playlist';
      createData.useBlueprint = false;
    } else if (!createData.isPlaylistChannel && createData.sourceType === 'RTMP' && !createData.sourceUrl) {
      createData.sourceUrl = buildMcrInternalIngestUrl(slug);
    }

    const channel = await prisma.channel.create({
      data: {
        ...createData,
        slug
      },
      include: {
        transcodingProfile: true,
        playlist: true,
        blueprint: true,
      },
    });

    if (channel.useBlueprint && channel.blueprintId) {
      const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
      const windowPath = await blueprintPlaybackService.refreshChannelWindow(channel.id);
      if (!windowPath) {
        logger.warn(
          `Blueprint channel "${channel.name}" created without playable content — assign playlists to blocks before starting`
        );
      }
      const { hybridChannelService } = await import('./hybridChannel.service');
      await hybridChannelService.ensureState(channel.id);
    }

    return channel;
  }

  async updateChannel(id: string, data: any) {
    await prisma.channel.update({
      where: { id },
      data,
    });

    const channel = await this.getChannelById(id);

    if (channel.status === 'ONLINE' || channel.status === 'STARTING') {
      await ffmpegService.restartStream(id, channel);
    }

    return channel;
  }

  async deleteChannel(id: string) {
    const channel = await this.getChannelById(id);
    
    if (channel.status !== 'OFFLINE') {
      await ffmpegService.stopStream(id);
    }

    await prisma.$transaction([
      prisma.overlay.deleteMany({ where: { channelId: id } }),
      prisma.token.deleteMany({ where: { channelId: id } }),
      prisma.streamLog.deleteMany({ where: { channelId: id } }),
      prisma.streamStats.deleteMany({ where: { channelId: id } }),
      prisma.channel.delete({ where: { id } })
    ]);
    
    return { success: true };
  }

  async startChannel(id: string) {
    let channel = await this.getChannelById(id);
    ffmpegService.clearReconnectState(id);

    const { sourceRouterService } = await import('./sourceRouter.service');
    const mcrEnabled = await sourceRouterService.isMcrEnabledChannel(id);

    if (channel.status === 'ERROR') {
      await prisma.channel.update({ where: { id }, data: { status: 'OFFLINE', pid: null } });
      channel.status = 'OFFLINE';
    }

    if (mcrEnabled) {
      await sourceRouterService.migrateMcrChannelSourceUrl(id);
      await sourceRouterService.ensureProgramBus(id);
      channel = await this.getChannelById(id);
    } else if (channel.blueprintId) {
      const wantsBlueprint = channel.useBlueprint || !channel.playlistId;
      if (wantsBlueprint) {
        if (!channel.useBlueprint || channel.playlistId) {
          await prisma.channel.update({
            where: { id },
            data: { useBlueprint: true, playlistId: null },
          });
        }
        const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
        const windowPath = await blueprintPlaybackService.refreshChannelWindow(id);
        if (!windowPath) {
          throw new AppError(
            'Cannot start — blueprint blocks need playlists with READY videos. Open Blueprint and assign content to each block.',
            400
          );
        }
        channel = await this.getChannelById(id);
      }
    }

    await ffmpegService.startStream(channel, {
      force: !!(channel.useBlueprint && channel.blueprintId && !mcrEnabled),
    });

    if (mcrEnabled) {
      const { mcrBindingService } = await import('./mcrBinding.service');
      await mcrBindingService.assertProgramEncoderBound(id, 'startChannel');
    }

    return { message: 'Stream started' };
  }

  async stopChannel(id: string) {
    ffmpegService.clearReconnectState(id);

    // Clear hybrid live override before killing decoders — prevents auto-restart loop.
    await prisma.hybridChannelState.updateMany({
      where: { channelId: id },
      data: { activeSource: 'BLUEPRINT', transitionInProgress: false, decoderPid: null },
    });

    const { hybridOutputService } = await import('./hybridOutput.service');
    await hybridOutputService.stop(id);

    const { sourceRouterService } = await import('./sourceRouter.service');
    if (await sourceRouterService.isMcrEnabledChannel(id)) {
      const { env } = await import('../config/env');
      if (env.MCR_ARCHITECTURE === 'v2-switcher') {
        const { mcrProgramEncoderService } = await import('./mcr/mcrProgramEncoder.service');
        await mcrProgramEncoderService.stop(id, 'stopChannel');
      } else {
        const { mcrRelayService } = await import('./mcrRelay.service');
        const { mcrBusHolderService } = await import('./mcrBusHolder.service');
        await mcrRelayService.stopRelay(id, 'stopChannel');
        await mcrBusHolderService.stopSlate(id);
      }
    }

    await ffmpegService.stopStream(id);
    return { message: 'Stream stopped' };
  }

  async restartChannel(id: string) {
    const channel = await this.getChannelById(id);
    ffmpegService.clearReconnectState(id);
    await ffmpegService.restartStream(id, channel);
    return { message: 'Stream restarting' };
  }

  async switchMode(id: string, mode: 'playlist' | 'live', sourceUrl?: string, sourceType?: string, playlistId?: string) {
    const channel = await this.getChannelById(id);

    const update: any = {};

    if (mode === 'playlist') {
      if (!playlistId && !channel.playlistId) {
        throw new AppError('playlistId is required to switch to playlist mode', 400);
      }
      update.isPlaylistChannel = true;
      update.useBlueprint = false;
      if (playlistId) update.playlistId = playlistId;
    } else {
      update.isPlaylistChannel = false;
      if (sourceType) update.sourceType = sourceType;
      const incomingType = (sourceType || channel.sourceType || 'RTMP').toUpperCase();

      if (sourceUrl && sourceUrl.trim()) {
        update.sourceUrl = sourceUrl.trim();
      } else if (!channel.sourceUrl || channel.sourceUrl === 'internal-playlist') {
        if (incomingType === 'RTMP') {
          update.sourceUrl = buildMcrInternalIngestUrl(channel.slug);
        } else {
          throw new AppError('sourceUrl is required to switch to live mode', 400);
        }
      }
    }

    const updated = await prisma.channel.update({
      where: { id },
      data: update,
      include: { transcodingProfile: true, overlays: true, playlist: true },
    });

    if (channel.status === 'ONLINE' || channel.status === 'STARTING') {
      await ffmpegService.restartStream(id, updated);
    }

    return updated;
  }

  async setPlaybackMode(id: string, mode: 'playlist' | 'blueprint', blueprintId?: string) {
    const channel = await this.getChannelById(id);
    if (!channel.isPlaylistChannel) {
      throw new AppError('Playback mode only applies to playlist channels', 400);
    }

    if (mode === 'blueprint') {
      const bpId = blueprintId || channel.blueprintId;
      if (!bpId) {
        throw new AppError('Select a blueprint or publish one to this channel first', 400);
      }
      const bp = await prisma.channelBlueprint.findUnique({ where: { id: bpId } });
      if (!bp) throw new AppError('Blueprint not found', 404);

      await prisma.channel.update({
        where: { id },
        data: { useBlueprint: true, blueprintId: bpId },
      });

      const { blueprintPlaybackService } = await import('./blueprintPlayback.service');
      await blueprintPlaybackService.refreshChannelWindow(id);
    } else {
      await prisma.channel.update({
        where: { id },
        data: { useBlueprint: false },
      });
    }

    const updated = await this.getChannelById(id);
    const wasRunning =
      channel.status === 'ONLINE' || channel.status === 'STARTING' || channel.status === 'ERROR';
    if (wasRunning || ffmpegService.getProcessInfo(id)) {
      await ffmpegService.forceRestartChannel(id);
    }

    const { monitorService } = await import('./monitor.service');
    monitorService.addLog(
      id,
      'INFO',
      `Playback mode set to ${mode === 'blueprint' ? 'Blueprint' : 'Playlist'}${updated.blueprint?.name ? ` (${updated.blueprint.name})` : ''}.`
    );

    return updated;
  }

  async getStats(id: string) {
    const processInfo = ffmpegService.getProcessInfo(id);
    if (processInfo) {
       return processInfo.stats;
    }
    return null;
  }
}

export const channelService = new ChannelService();
