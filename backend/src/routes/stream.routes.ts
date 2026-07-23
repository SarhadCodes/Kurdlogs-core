import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { getIptvApiKeyFromRequest } from '../middleware/iptvAuth';
import { channelService } from '../services/channel.service';
import { tokenService } from '../services/token.service';
import { viewerService } from '../services/viewer.service';
import { resolveStreamAccess, rewriteDashManifest, rewriteHlsPlaylist } from '../utils/streamAccess';
import { resolveStreamViewerId, viewerSessionQueryParam } from '../utils/viewerSession';
import { sanitizeLiveHlsPlaylist } from '../utils/hybridHls';
import { resolveStreamFileOnDisk, hasRecentHlsSegments, resolveStreamSegmentOnDisk, type StreamOutputMode } from '../utils/streamPaths';
import { ffmpegService } from '../services/ffmpeg.service';

const router = Router();

async function serveStreamFile(
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
  slug: string,
  file: string,
  options?: { queryToken?: string; pathToken?: string; outputMode?: StreamOutputMode; isPreviewRoute?: boolean }
) {
  if (options?.queryToken) {
    req.query.token = options.queryToken;
  }

  const access = await resolveStreamAccess(slug, req, {
    pathToken: options?.pathToken,
  });
  if (!access.allowed) {
    return next(new AppError('Invalid or expired token', 403));
  }

  const outputMode = options?.outputMode ?? 'blueprint';
  const allowStaleFallback = false;
  const normalizedFile = file.replace(/\\/g, '/').replace(/^\/+/, '');
  const isSegment = normalizedFile.endsWith('.ts');
  const filePath = isSegment
    ? resolveStreamSegmentOnDisk(slug, normalizedFile, outputMode, allowStaleFallback)
    : resolveStreamFileOnDisk(slug, normalizedFile, outputMode);

  if (!filePath || !filePath.startsWith(env.STREAMS_DIR)) {
    let channel: { id: string; status: string; name: string } | null = null;
    if (!slug.startsWith('mcr-sess-')) {
      try {
        channel = await channelService.getChannelBySlug(slug);
      } catch {
        /* unknown slug */
      }
    }

    if (channel) {
      const proc = ffmpegService.getProcessInfo(channel.id);
      if (channel.status === 'ONLINE' && !proc) {
        return next(
          new AppError(
            'Channel shows online but FFmpeg is not running. Open the channel and click Restart.',
            404
          )
        );
      }
      if (channel.status === 'ONLINE' && proc && !hasRecentHlsSegments(slug)) {
        return next(
          new AppError(
            'Stream is starting or stalled. Wait 15–30 seconds or restart the channel.',
            404
          )
        );
      }
      if (channel.status === 'OFFLINE' || channel.status === 'ERROR') {
        return next(
          new AppError('Channel is not running. Start the channel from the dashboard first.', 404)
        );
      }
    }

    return next(
      new AppError(
        'Stream not found or offline. Start the channel and wait until preview plays in the dashboard.',
        404
      )
    );
  }

  const noCache = 'no-store, no-cache, must-revalidate';

  const trackViewer = !options?.isPreviewRoute && !slug.startsWith('mcr-sess-');
  if (trackViewer) {
    void viewerService.touchFromStream(req, slug);
  }

  const viewerId = trackViewer ? resolveStreamViewerId(req, slug) : '';
  const vsidQuery = trackViewer ? viewerSessionQueryParam(viewerId) : '';

  function mergePlaylistQuery(existing?: string): string | undefined {
    if (!vsidQuery) return existing;
    if (!existing) return vsidQuery;
    return `${existing}&${vsidQuery}`;
  }

  if (file.endsWith('.m3u8')) {
    res.setHeader('Cache-Control', noCache);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');

    let content = fs.readFileSync(filePath, 'utf8');
    content = sanitizeLiveHlsPlaylist(content);
    const playlistQuery = mergePlaylistQuery(
      access.appendQuery && !access.tokenInPath ? access.appendQuery : undefined
    );
    if (playlistQuery) {
      content = rewriteHlsPlaylist(content, playlistQuery);
    }
    return res.send(content);
  }

  if (file.endsWith('.mpd')) {
    res.setHeader('Cache-Control', noCache);
    res.setHeader('Content-Type', 'application/dash+xml');

    let content = fs.readFileSync(filePath, 'utf8');
    const manifestQuery = mergePlaylistQuery(
      access.appendQuery && !access.tokenInPath ? access.appendQuery : undefined
    );
    if (manifestQuery) {
      content = rewriteDashManifest(content, manifestQuery);
    }
    return res.send(content);
  }

  if (file.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/MP2T');
    if (access.appendQuery) {
      res.setHeader('Cache-Control', noCache);
    }
  }

  if (file.endsWith('.m4s') || file.endsWith('.mp4')) {
    res.setHeader('Content-Type', 'video/iso.segment');
    if (access.appendQuery) {
      res.setHeader('Cache-Control', noCache);
    }
  }

  res.sendFile(filePath);
}

/**
 * Stable IPTV URL — never changes. Each request uses the latest token in the manifest.
 * Example: /stream/play/mychannel/index.m3u8?api_key=YOUR_KEY
 */
router.get('/play/:slug/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const file = String(req.params.file || 'index.m3u8');

    const apiKey = getIptvApiKeyFromRequest(req);
    if (!apiKey || apiKey !== env.IPTV_API_KEY) {
      return next(new AppError('Invalid IPTV API key', 403));
    }

    const channel = await channelService.getChannelBySlug(slug);
    const tokenRecord = await tokenService.getActiveTokenForChannel(channel.id);
    if (!tokenRecord) {
      return next(new AppError('No active stream token for this channel', 403));
    }

    return serveStreamFile(req, res, next, slug, file, { queryToken: tokenRecord.token });
  } catch (error) {
    next(error);
  }
});

/** Token in path — e.g. /stream/mychannel/t/TOKEN/master.m3u8 */
router.get('/:slug/t/:token/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const token = decodeURIComponent(String(req.params.token));
    const file = String(req.params.file || 'master.m3u8');
    return serveStreamFile(req, res, next, slug, file, { pathToken: token });
  } catch (error) {
    next(error);
  }
});

router.get('/:slug/preview/blueprint/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const file = String(req.params.file || 'master.m3u8');
    return serveStreamFile(req, res, next, slug, file, { outputMode: 'blueprint', isPreviewRoute: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:slug/preview/live/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const file = String(req.params.file || 'master.m3u8');
    return serveStreamFile(req, res, next, slug, file, { outputMode: 'live', isPreviewRoute: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:slug/preview/loop/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const file = String(req.params.file || 'master.m3u8');
    return serveStreamFile(req, res, next, slug, file, { outputMode: 'loop', isPreviewRoute: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:slug/preview/emergency/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const file = String(req.params.file || 'master.m3u8');
    return serveStreamFile(req, res, next, slug, file, { outputMode: 'emergency', isPreviewRoute: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:slug/preview/station/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const file = String(req.params.file || 'master.m3u8');
    return serveStreamFile(req, res, next, slug, file, { outputMode: 'station', isPreviewRoute: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:slug/preview/program/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const file = String(req.params.file || 'master.m3u8');
    return serveStreamFile(req, res, next, slug, file, { outputMode: 'program', isPreviewRoute: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:slug/:file(*)', async (req: Request, res: Response, next) => {
  try {
    const slug = String(req.params.slug);
    const file = String(req.params.file);
    return serveStreamFile(req, res, next, slug, file);
  } catch (error) {
    next(error);
  }
});

export default router;
