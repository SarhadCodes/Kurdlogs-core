import { GraphicsMode } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { appLogService } from '../appLog.service';
import { wsService } from '../websocket.service';
import { validateGraphicsDocument } from './graphicsScene.service';

class GraphicsControlService {
  async get(channelId: string) {
    await this.assertChannel(channelId);
    return prisma.channelGraphics.findUnique({ where: { channelId }, include: { scene: { include: { asset: true } } } });
  }

  async save(channelId: string, input: Record<string, unknown>, operator?: string) {
    await this.assertChannel(channelId);
    const mode = input.mode as GraphicsMode;
    if (!Object.values(GraphicsMode).includes(mode)) throw new AppError('Invalid graphics mode', 400);
    const document = validateGraphicsDocument(input.document);
    const assetId = typeof input.assetId === 'string' ? input.assetId : undefined;
    if (assetId && !(await prisma.graphicsAsset.findUnique({ where: { id: assetId } }))) throw new AppError('Graphics asset not found', 404);
    const previous = await prisma.channelGraphics.findUnique({ where: { channelId }, include: { scene: true } });
    const nextVersion = (previous?.sceneVersion || 0) + 1;
    const scene = await prisma.graphicsScene.create({
      data: { name: `channel-${channelId}`, version: nextVersion, document, assetId: assetId || null, isPublished: false },
      include: { asset: true },
    });
    const state = await prisma.channelGraphics.upsert({
      where: { channelId },
      create: { channelId, mode, enabled: Boolean(input.enabled), sceneId: scene.id, sceneVersion: nextVersion, rendererState: mode === 'PLAYER' ? 'READY' : 'PENDING_RENDERER' },
      update: { mode, enabled: Boolean(input.enabled), sceneId: scene.id, sceneVersion: nextVersion, rendererState: mode === 'PLAYER' ? 'READY' : 'PENDING_RENDERER', lastError: null },
      include: { scene: { include: { asset: true } } },
    });
    await appLogService.log('GRAPHICS', `Graphics scene saved for channel ${channelId}`, 'INFO', { channelId, sceneVersion: nextVersion, operator });
    wsService.emitGraphicsState(channelId, state as unknown as Record<string, unknown>);
    return state;
  }

  async publish(channelId: string, commandId: string, operator?: string) {
    const state = await prisma.channelGraphics.findUnique({ where: { channelId }, include: { scene: { include: { asset: true } } } });
    if (!state?.scene) throw new AppError('Create a graphics scene before publishing', 400);
    await prisma.graphicsScene.update({ where: { id: state.scene.id }, data: { isPublished: true } });
    let updated = await prisma.channelGraphics.update({
      where: { channelId },
      data: { enabled: true, rendererState: state.mode === 'PLAYER' ? 'RUNNING' : 'APPLYING', lastCommandId: commandId },
      include: { scene: { include: { asset: true } } },
    });
    updated = await this.applyBurnInIfNeeded(channelId, updated);
    const command = { id: commandId, type: 'graphics.scene.publish', channelId, sceneVersion: state.sceneVersion, timestamp: new Date().toISOString() };
    wsService.emitGraphicsCommand(channelId, command);
    wsService.emitGraphicsState(channelId, updated as unknown as Record<string, unknown>);
    await appLogService.log('GRAPHICS', `Graphics scene published for channel ${channelId}`, 'INFO', { ...command, operator, mode: state.mode });
    return { state: updated, command, burnedInAvailable: true };
  }

  async setVisibility(channelId: string, visible: boolean, commandId: string, operator?: string) {
    const state = await prisma.channelGraphics.findUnique({ where: { channelId } });
    if (!state) throw new AppError('Graphics scene not configured', 404);
    let updated = await prisma.channelGraphics.update({
      where: { channelId },
      data: { enabled: visible, rendererState: state.mode === 'PLAYER' ? (visible ? 'RUNNING' : 'READY') : 'APPLYING', lastCommandId: commandId },
      include: { scene: { include: { asset: true } } },
    });
    updated = await this.applyBurnInIfNeeded(channelId, updated);
    const command = { id: commandId, type: visible ? 'graphics.node.show' : 'graphics.node.hide', channelId, sceneVersion: state.sceneVersion, timestamp: new Date().toISOString() };
    wsService.emitGraphicsCommand(channelId, command);
    wsService.emitGraphicsState(channelId, updated as unknown as Record<string, unknown>);
    await appLogService.log('GRAPHICS', `Graphics ${visible ? 'shown' : 'hidden'} for channel ${channelId}`, 'INFO', { ...command, operator });
    return { state: updated, command };
  }

  private async assertChannel(channelId: string) {
    if (!(await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true } }))) throw new AppError('Channel not found', 404);
  }

  /** A static FFmpeg filter graph is fixed at process start, so burn-in changes restart only this channel. */
  private async applyBurnInIfNeeded(channelId: string, state: any) {
    if (state.mode === GraphicsMode.PLAYER) return state;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { status: true },
    });
    if (!channel || !['ONLINE', 'STARTING', 'ERROR'].includes(channel.status)) {
      return prisma.channelGraphics.update({
        where: { channelId },
        data: { rendererState: 'READY' },
        include: { scene: { include: { asset: true } } },
      });
    }

    try {
      const { ffmpegService } = await import('../ffmpeg.service');
      await ffmpegService.restartStream(channelId);
      return prisma.channelGraphics.update({
        where: { channelId },
        data: { rendererState: 'RUNNING', lastError: null },
        include: { scene: { include: { asset: true } } },
      });
    } catch (error: any) {
      const message = error?.message || 'Unable to restart channel for burned-in graphics';
      await prisma.channelGraphics.update({ where: { channelId }, data: { rendererState: 'ERROR', lastError: message } });
      throw new AppError(message, 500);
    }
  }
}

export const graphicsControlService = new GraphicsControlService();
