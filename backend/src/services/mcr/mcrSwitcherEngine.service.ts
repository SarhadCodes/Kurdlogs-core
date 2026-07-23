import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { mcrSourceSessionService } from '../mcrSourceSession.service';
import { buildMcrSwitcherSourceUrl } from './mcrSwitcherUrl';
import { mcrActiveInputService } from './mcrActiveInput.service';
import { mcrInputRegistryService } from './mcrInputRegistry.service';
import { mcrProgramEncoderService } from './mcrProgramEncoder.service';

export type McrSwitcherTransition = 'TAKE' | 'CUT' | 'FADE' | 'AUTO';

export interface McrSwitchOptions {
  transition?: McrSwitcherTransition;
  fadeMs?: number;
}

/**
 * Control Room Switcher Engine — TAKE/CUT/AUTO only change the active input slot.
 * No RTMP bus relay, no ffprobe gates, no encoder restart on switch.
 */
class McrSwitcherEngineService {
  async ensurePermanentOutput(channelId: string, programSourceId?: string | null): Promise<void> {
    const registry = await mcrInputRegistryService.buildRegistry(channelId);
    const slot = mcrInputRegistryService.getSlotForSource(registry, programSourceId);
    await mcrProgramEncoderService.ensureRunning(channelId, slot);

    const switcherUrl = buildMcrSwitcherSourceUrl(channelId);
    const { prisma } = await import('../../config/database');
    await prisma.channel.update({
      where: { id: channelId },
      data: {
        sourceUrl: switcherUrl,
        sourceType: 'HTTP',
        isPlaylistChannel: false,
        useBlueprint: false,
      },
    });
  }

  async switchProgramToSource(
    channelId: string,
    sourceId: string,
    options?: McrSwitchOptions
  ): Promise<number> {
    if (
      options?.transition === 'AUTO' &&
      mcrSourceSessionService.isSourceFrozen(channelId, sourceId)
    ) {
      logger.warn(
        `[MCR_SWITCHER] block-auto channelId=${channelId} sourceId=${sourceId} frozen=true`
      );
      throw new Error('Automation source is frozen — AUTO blocked');
    }

    const registry = await mcrInputRegistryService.buildRegistry(channelId);
    const slot = mcrInputRegistryService.getSlotForSource(registry, sourceId);

    if (!mcrProgramEncoderService.isRunning(channelId)) {
      await mcrProgramEncoderService.ensureRunning(channelId, slot);
    } else {
      await mcrProgramEncoderService.switchInputSlot(channelId, slot);
    }

    if (options?.transition === 'FADE' || options?.transition === 'AUTO') {
      const fadeMs = options.fadeMs ?? env.MCR_FADE_DURATION_MS;
      logger.info(
        `[MCR_SWITCHER] fade-requested channelId=${channelId} fadeMs=${fadeMs} ` +
          `note=instant-cut-v2 (crossfade planned)`
      );
    }

    logger.info(
      `[MCR_PROGRAM_ACTIVE] channelId=${channelId} sourceId=${sourceId} slot=${slot} ` +
        `transition=${options?.transition ?? 'CUT'} encoderRestart=false busRouteOnly=false switcherOnly=true`
    );

    return slot;
  }

  async executeTake(
    channelId: string,
    newProgramId: string,
    newPreviewId: string | null,
    transition: McrSwitcherTransition = 'TAKE',
    fadeMs?: number
  ): Promise<void> {
    const registry = await mcrInputRegistryService.buildRegistry(channelId);
    const programSlot = mcrInputRegistryService.getSlotForSource(registry, newProgramId);
    const previewSlot = mcrInputRegistryService.getSlotForSource(registry, newPreviewId);

    await this.switchProgramToSource(channelId, newProgramId, {
      transition: transition === 'TAKE' ? 'CUT' : transition,
      fadeMs,
    });

    await mcrActiveInputService.swapTake(
      channelId,
      newProgramId,
      programSlot,
      newPreviewId,
      previewSlot
    );
  }

  async executeCut(channelId: string, sourceId: string): Promise<void> {
    const slot = await this.switchProgramToSource(channelId, sourceId, { transition: 'CUT' });
    await mcrActiveInputService.assignProgram(channelId, sourceId, slot, 'MANUAL');
  }

  async executeAuto(channelId: string, automationSourceId: string, fadeMs?: number): Promise<void> {
    const slot = await this.switchProgramToSource(channelId, automationSourceId, {
      transition: 'AUTO',
      fadeMs,
    });
    await mcrActiveInputService.assignProgram(channelId, automationSourceId, slot, 'AUTOMATION');
  }

  async executePreview(channelId: string, sourceId: string): Promise<void> {
    const registry = await mcrInputRegistryService.buildRegistry(channelId);
    const slot = mcrInputRegistryService.getSlotForSource(registry, sourceId);
    await mcrActiveInputService.assignPreview(channelId, sourceId, slot);
    logger.info(
      `[MCR_PREVIEW_ASSIGNED] channelId=${channelId} sourceId=${sourceId} slot=${slot} switcherPreviewOnly=true`
    );
  }
}

export const mcrSwitcherEngineService = new McrSwitcherEngineService();
