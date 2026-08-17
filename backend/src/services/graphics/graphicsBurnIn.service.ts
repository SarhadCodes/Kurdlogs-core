import { GraphicsMode } from '@prisma/client';
import { prisma } from '../../config/database';
import { graphicsAssetService } from './graphicsAsset.service';
import { validateGraphicsDocument } from './graphicsScene.service';

/**
 * Adapts a published GraphicsScene into the existing FFmpeg overlay contract.
 * Keeping this as a small adapter means static graphics use the same validated
 * asset and filter pipeline as the established overlay feature.
 */
class GraphicsBurnInService {
  async getActiveOverlay(channelId: string): Promise<Record<string, unknown> | null> {
    const graphics = await prisma.channelGraphics.findUnique({
      where: { channelId },
      include: { scene: { include: { asset: true } } },
    });

    if (
      !graphics?.enabled ||
      !graphics.scene?.isPublished ||
      !graphics.scene.asset ||
      (graphics.mode !== GraphicsMode.BURN_IN && graphics.mode !== GraphicsMode.HYBRID)
    ) {
      return null;
    }

    const document = validateGraphicsDocument(graphics.scene.document);
    const node = document.nodes.find((candidate) => candidate.type === 'image' && candidate.visible);
    if (!node) return null;

    return {
      id: `graphics-${graphics.scene.id}`,
      type: 'WATERMARK',
      isActive: true,
      // This marker lets the playlist pipeline allow an explicitly requested
      // broadcast graphic while preserving its default ingest-time branding rule.
      isGraphicsOverlay: true,
      config: {
        // Pre-compose opacity into the cached logo asset. This leaves the
        // long-running FFmpeg program graph with only scale + overlay work.
        path: graphicsAssetService.getBroadcastAssetPath(graphics.scene.asset, node.opacity),
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        opacity: 1,
      },
    };
  }
}

export const graphicsBurnInService = new GraphicsBurnInService();
