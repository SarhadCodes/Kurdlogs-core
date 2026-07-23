import { prisma } from '../../config/database';
import { McrRoutingMode } from '@prisma/client';

export interface McrActiveInputState {
  channelId: string;
  programSourceId: string | null;
  previewSourceId: string | null;
  automationSourceId: string | null;
  routingMode: McrRoutingMode;
  programSlot: number;
  previewSlot: number;
}

/**
 * Active Input Manager — persists preview/program/automation selection in DB
 * and exposes slot indices for the switcher engine.
 */
class McrActiveInputService {
  async getState(channelId: string): Promise<McrActiveInputState | null> {
    const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
    if (!router) return null;

    return {
      channelId,
      programSourceId: router.programSourceId,
      previewSourceId: router.previewSourceId,
      automationSourceId: router.automationSourceId,
      routingMode: router.routingMode,
      programSlot: router.programInputSlot ?? 0,
      previewSlot: router.previewInputSlot ?? 0,
    };
  }

  async assignPreview(channelId: string, sourceId: string, slot: number): Promise<void> {
    await prisma.mcrRouterState.update({
      where: { channelId },
      data: { previewSourceId: sourceId, previewInputSlot: slot },
    });
  }

  async assignProgram(
    channelId: string,
    sourceId: string,
    slot: number,
    routingMode: McrRoutingMode
  ): Promise<void> {
    await prisma.mcrRouterState.update({
      where: { channelId },
      data: {
        programSourceId: sourceId,
        programInputSlot: slot,
        routingMode,
      },
    });
  }

  async swapTake(
    channelId: string,
    newProgramId: string,
    newProgramSlot: number,
    newPreviewId: string | null,
    newPreviewSlot: number
  ): Promise<void> {
    await prisma.mcrRouterState.update({
      where: { channelId },
      data: {
        programSourceId: newProgramId,
        programInputSlot: newProgramSlot,
        previewSourceId: newPreviewId,
        previewInputSlot: newPreviewSlot,
        routingMode: 'MANUAL',
      },
    });
  }
}

export const mcrActiveInputService = new McrActiveInputService();
