import { Request, Response } from 'express';
import { channelService } from '../services/channel.service';
import { tokenService } from '../services/token.service';
import { env } from '../config/env';
import { getPublicBaseUrl } from '../config/publicUrl';
export const listChannels = async (_req: Request, res: Response) => {
  const channels = await channelService.getAllChannels();
  const data = await Promise.all(
    channels.map(async (ch) => tokenService.buildIptvChannelInfo(ch))
  );
  res.json({ success: true, data });
};

export const getChannel = async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const channel = await channelService.getChannelBySlug(slug);
  const data = await tokenService.buildIptvChannelInfo(channel);
  res.json({ success: true, data });
};

/** Poll this before expiry; returns current + overlapping previous token during rotation */
export const getStreamToken = async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const channel = await channelService.getChannelBySlug(slug);
  const play = await tokenService.getIptvPlayInfo(channel);

  if (!play) {
    return res.status(404).json({
      success: false,
      error: 'No active stream token for this channel. Create a token in the dashboard first.',
    });
  }

  res.json({ success: true, data: play });
};

export const getIptvDocs = async (_req: Request, res: Response) => {
  const base = getPublicBaseUrl();
  res.json({
    success: true,
    data: {
      auth: 'Send header X-IPTV-Key: <your-key> or ?api_key=<your-key>',
      endpoints: {
        listChannels: `GET ${base}/api/iptv/channels`,
        channel: `GET ${base}/api/iptv/channels/:slug`,
        streamToken: `GET ${base}/api/iptv/channels/:slug/token`,
        stableHlsPlayUrl: `${base}/stream/play/:slug/index.m3u8?api_key=<your-key>`,
        stableDashPlayUrl: `${base}/stream/play/:slug/manifest.mpd?api_key=<your-key>`,
      },
      seamlessRefresh:
        'Tokens refresh before expiry. Old token stays valid for an overlap window so players can switch without interruption. Poll /token every 30–60s or use the stable /stream/play/ URL.',
    },
  });
};
