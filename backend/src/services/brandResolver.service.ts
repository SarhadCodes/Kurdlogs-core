import { prisma } from '../config/database';
import { brandProfileService } from './brandProfile.service';
import type { LogoBurnConfig } from './overlay.service';

/**
 * Resolve branding for a playlist item:
 * 1) per-item logoConfig override (if enabled)
 * 2) playlist.brandProfile
 * 3) channel.brandProfile (first playlist channel)
 */
class BrandResolverService {
  async resolveForBrandProfileId(brandProfileId: string): Promise<LogoBurnConfig | null> {
    const profile = await brandProfileService.getById(brandProfileId);
    return brandProfileService.toLogoConfig(profile);
  }

  async resolveForItem(itemId: string): Promise<LogoBurnConfig | null> {
    const item = await prisma.playlistItem.findUnique({
      where: { id: itemId },
      include: {
        playlist: { include: { brandProfile: true, channels: { include: { brandProfile: true } } } },
      },
    });
    if (!item) return null;

    const itemCfg = item.logoConfig as LogoBurnConfig | null;
    if (itemCfg?.enabled && (itemCfg.path || itemCfg.imagePath)) {
      return itemCfg;
    }

    if (item.playlist.brandProfile) {
      const fromPlaylist = brandProfileService.toLogoConfig(item.playlist.brandProfile);
      if (fromPlaylist) return fromPlaylist;
    }

    const channel = item.playlist.channels.find((c) => c.isPlaylistChannel && c.brandProfile);
    if (channel?.brandProfile) {
      return brandProfileService.toLogoConfig(channel.brandProfile);
    }

    return null;
  }

  async resolveForPlaylist(playlistId: string): Promise<LogoBurnConfig | null> {
    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      include: { brandProfile: true, channels: { include: { brandProfile: true } } },
    });
    if (!playlist) return null;

    if (playlist.brandProfile) {
      const cfg = brandProfileService.toLogoConfig(playlist.brandProfile);
      if (cfg) return cfg;
    }

    const channel = playlist.channels.find((c) => c.isPlaylistChannel && c.brandProfile);
    if (channel?.brandProfile) {
      return brandProfileService.toLogoConfig(channel.brandProfile);
    }

    return null;
  }
}

export const brandResolverService = new BrandResolverService();
