import { Request, Response } from 'express';
import { channelService } from '../services/channel.service';
import { monitorService } from '../services/monitor.service';
import { tokenService } from '../services/token.service';
import { env } from '../config/env';
import { buildMcrInternalIngestUrl } from '../config/mcrRtmp';
import { getPublicBaseUrl, publicHostFromBase, resolveRequestBaseUrl } from '../config/publicUrl';
import { getPublishedHlsManifest, hasRecentHlsSegments } from '../utils/streamPaths';
import { buildPublicStreamUrl, buildTokenStreamUrl } from '../utils/streamUrls';
import { ffmpegService } from '../services/ffmpeg.service';

export const getAllChannels = async (req: Request, res: Response) => {
  const channels = await channelService.getAllChannels();
  res.json({ success: true, data: channels });
};

export const getChannelById = async (req: Request, res: Response) => {
  const channel = await channelService.getChannelById(String(req.params.id));
  res.json({ success: true, data: channel });
};

export const createChannel = async (req: Request, res: Response) => {
  const channel = await channelService.createChannel(req.body);
  res.status(201).json({ success: true, data: channel });
};

export const updateChannel = async (req: Request, res: Response) => {
  const channel = await channelService.updateChannel(String(req.params.id), req.body);
  res.json({ success: true, data: channel });
};

export const deleteChannel = async (req: Request, res: Response) => {
  await channelService.deleteChannel(String(req.params.id));
  res.json({ success: true, message: 'Channel deleted' });
};

export const startChannel = async (req: Request, res: Response) => {
  const result = await channelService.startChannel(String(req.params.id));
  res.json({ success: true, ...result });
};

export const stopChannel = async (req: Request, res: Response) => {
  const result = await channelService.stopChannel(String(req.params.id));
  res.json({ success: true, ...result });
};

export const restartChannel = async (req: Request, res: Response) => {
  const result = await channelService.restartChannel(String(req.params.id));
  res.json({ success: true, ...result });
};

export const setPlaybackMode = async (req: Request, res: Response) => {
  const { mode, blueprintId } = req.body;
  if (!mode || !['playlist', 'blueprint'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'mode must be "playlist" or "blueprint"' });
  }
  const channel = await channelService.setPlaybackMode(String(req.params.id), mode, blueprintId);
  res.json({ success: true, data: channel });
};

export const switchMode = async (req: Request, res: Response) => {
  const { mode, sourceUrl, sourceType, playlistId } = req.body;
  if (!mode || !['playlist', 'live'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'mode must be "playlist" or "live"' });
  }
  const channel = await channelService.switchMode(String(req.params.id), mode, sourceUrl, sourceType, playlistId);
  res.json({ success: true, data: channel });
};

export const getChannelStats = async (req: Request, res: Response) => {
  const stats = await channelService.getStats(String(req.params.id));
  res.json({ success: true, data: stats });
};

export const getChannelLogs = async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const logs = await monitorService.getChannelLogs(String(req.params.id), limit);
  res.json({ success: true, data: logs });
};

export const clearChannelLogs = async (req: Request, res: Response) => {
  const result = await monitorService.clearChannelLogs(String(req.params.id));
  res.json({ success: true, message: 'Channel logs cleared', data: { deleted: result.count } });
};

function requestBaseUrl(req: Request): string {
  return resolveRequestBaseUrl(req);
}

function ingestHostFromBase(base: string): string {
  return publicHostFromBase(base);
}

/** Playback URLs for VLC / IPTV apps (admin). Uses request Host so VLC on same machine works. */
export const getChannelPlayUrls = async (req: Request, res: Response) => {
  const channel = await channelService.getChannelById(String(req.params.id));
  const base = requestBaseUrl(req);
  const ingestHost = ingestHostFromBase(base);
  const tokenProtected = await tokenService.hasActiveTokens(channel.id);
  const play = await tokenService.getIptvPlayInfo(channel);
  const slug = channel.slug;

  const hls = getPublishedHlsManifest(slug) ?? 'master.m3u8';
  const dash = 'manifest.mpd';
  const proc = ffmpegService.getProcessInfo(channel.id);
  const streamReady = hasRecentHlsSegments(slug) || !!proc;

  res.json({
    success: true,
    data: {
      baseUrl: base,
      slug,
      status: channel.status,
      tokenProtected,
      requiresAuth: tokenProtected,
      streamReady,
      hlsManifest: hls,
      play,
      urls: {
        publicHls: buildPublicStreamUrl(base, slug, hls),
        publicDash: buildPublicStreamUrl(base, slug, dash),
        hlsWithToken: play ? buildTokenStreamUrl(base, slug, play.token, hls) : null,
        dashWithToken: play ? buildTokenStreamUrl(base, slug, play.token, dash) : null,
        stableHls: play
          ? `${base}/stream/play/${slug}/${hls}?api_key=${encodeURIComponent(env.IPTV_API_KEY)}`
          : null,
        stableDash: play
          ? `${base}/stream/play/${slug}/${dash}?api_key=${encodeURIComponent(env.IPTV_API_KEY)}`
          : null,
      },
      ingest: {
        serverUrl: `rtmp://${ingestHost}:${env.RTMP_PUBLISH_PORT}/live`,
        streamKey: slug,
        publishUrl: `rtmp://${ingestHost}:${env.RTMP_PUBLISH_PORT}/live/${slug}`,
        internalSourceUrl: buildMcrInternalIngestUrl(slug),
        publishPort: env.RTMP_PUBLISH_PORT,
        mcrRtmpPort: env.MCR_RTMP_PORT,
      },
      vlcHint:
        tokenProtected && play
          ? 'In VLC: paste the token HLS URL from “With stream token” (token is in the path, not after .m3u8). Or use IPTV stable HLS.'
          : 'In VLC: Media → Open Network Stream → paste the HLS URL. Use HLS (.m3u8), not DASH, for best compatibility.',
    },
  });
};
