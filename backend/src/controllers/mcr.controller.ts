import { Response } from 'express';
import { AuthRequest } from '../types';
import { sourceRouterService, type AddMcrSourceInput } from '../services/sourceRouter.service';
import { mcrIngestService } from '../services/mcrIngest.service';
import { mcrSourceSessionService } from '../services/mcrSourceSession.service';
import { prisma } from '../config/database';
import { getPublishedHlsManifest } from '../utils/streamPaths';
import { buildPublicStreamUrl } from '../utils/streamUrls';
import { logger } from '../utils/logger';

function operatorFromReq(req: AuthRequest) {
  if (!req.user) return undefined;
  return { id: req.user.id, username: req.user.username };
}

export const listMcrChannels = async (_req: AuthRequest, res: Response) => {
  const channels = await prisma.channel.findMany({
    orderBy: { name: 'asc' },
    include: { mcrRouter: { select: { enabled: true, routingMode: true } } },
  });
  res.json({ success: true, data: channels });
};

export const getMcrState = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const snap = await sourceRouterService.getSnapshot(channelId);
  if (!snap) {
    res.status(404).json({ success: false, error: 'Channel not found' });
    return;
  }
  res.json({ success: true, data: snap });
};

export const initMcr = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const snap = await sourceRouterService.initRouter(channelId, operatorFromReq(req));
  res.json({ success: true, data: snap });
};

export const setMcrPreview = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const { sourceId } = req.body as { sourceId?: string };
  if (!sourceId) {
    res.status(400).json({ success: false, error: 'sourceId required' });
    return;
  }
  const snap = await sourceRouterService.setPreview(channelId, sourceId, operatorFromReq(req));
  res.json({ success: true, data: snap });
};

export const takeMcr = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const { transition, fadeDurationMs } = (req.body ?? {}) as {
    transition?: 'TAKE' | 'FADE';
    fadeDurationMs?: number;
  };
  const snap = await sourceRouterService.takeSource(
    channelId,
    operatorFromReq(req),
    transition === 'FADE' ? 'FADE' : 'TAKE',
    fadeDurationMs
  );
  res.json({ success: true, data: snap });
};

export const cutMcr = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const { sourceId } = req.body as { sourceId?: string };
  const snap = await sourceRouterService.cutSource(channelId, sourceId, operatorFromReq(req));
  res.json({ success: true, data: snap });
};

export const autoMcr = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const { fadeDurationMs } = (req.body ?? {}) as { fadeDurationMs?: number };
  const snap = await sourceRouterService.autoReturn(
    channelId,
    operatorFromReq(req),
    fadeDurationMs
  );
  res.json({ success: true, data: snap });
};

export const addRtmpSource = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const { label, inputUrl } = req.body as { label?: string; inputUrl?: string };
  if (!label || !inputUrl) {
    res.status(400).json({ success: false, error: 'label and inputUrl required' });
    return;
  }
  const source = await sourceRouterService.addRtmpSource(
    channelId,
    label,
    inputUrl,
    operatorFromReq(req)
  );
  res.status(201).json({ success: true, data: source });
};

export const getSourcePreviewUrl = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const sourceId = String(req.params.sourceId);
  const base = `${req.protocol}://${req.get('host')}`;

  const source = await prisma.mcrSource.findFirst({
    where: { id: sourceId, routerChannelId: channelId },
  });
  if (!source) {
    res.status(404).json({ success: false, error: 'Source not found' });
    return;
  }

  const router = await prisma.mcrRouterState.findUnique({ where: { channelId } });
  if (router?.enabled) {
    const sessionKey = await sourceRouterService.ensureSourceSession(channelId, sourceId);
    if (sessionKey) {
      const slug = mcrSourceSessionService.getSessionPreviewSlug(channelId, sourceId);
      const manifest = getPublishedHlsManifest(slug) ?? 'index.m3u8';
      const url = sourceRouterService.getPreviewSessionUrl(channelId, sourceId);
      logger.info(
        `[MCR_PLAYER] action=preview-url channelId=${channelId} sourceId=${sourceId} ` +
          `sessionKey=${sessionKey} slug=${slug} manifest=${manifest}`
      );
      res.json({
        success: true,
        data: { url, slug, manifest, kind: 'hls', sessionKey, persistent: true },
      });
      return;
    }
  }

  if (source.sourceType === 'BLUEPRINT' || source.sourceType === 'PLAYLIST') {
    if (!source.refChannelId) {
      res.status(400).json({ success: false, error: 'Source has no channel reference' });
      return;
    }
    const ch = await prisma.channel.findUnique({
      where: { id: source.refChannelId },
      select: { slug: true, transcodingProfile: { select: { resolution: true } } },
    });
    if (!ch) {
      res.status(404).json({ success: false, error: 'Referenced channel not found' });
      return;
    }
    const manifest = getPublishedHlsManifest(ch.slug) ?? '720p/index.m3u8';
    const url = buildPublicStreamUrl(base, ch.slug, manifest);
    res.json({
      success: true,
      data: { url, slug: ch.slug, manifest, kind: 'hls' },
    });
    return;
  }

  if (source.sourceType === 'HLS' && source.inputUrl) {
    res.json({ success: true, data: { url: source.inputUrl, kind: 'hls' } });
    return;
  }

  if (
    (source.sourceType === 'RTMP' || source.sourceType === 'RTMP_INGEST') &&
    source.refChannelId
  ) {
    const ch = await prisma.channel.findUnique({
      where: { id: source.refChannelId },
      select: { slug: true },
    });
    if (ch) {
      const manifest = getPublishedHlsManifest(ch.slug) ?? '720p/index.m3u8';
      const url = buildPublicStreamUrl(base, ch.slug, manifest);
      res.json({ success: true, data: { url, slug: ch.slug, manifest, kind: 'hls' } });
      return;
    }
  }

  if (source.sourceType === 'RTMP' || source.sourceType === 'RTMP_INGEST') {
    res.json({
      success: true,
      data: { url: source.inputUrl, kind: 'rtmp', note: 'RTMP preview requires relay — use TAKE to route to program bus' },
    });
    return;
  }

  res.json({
    success: true,
    data: { url: null, kind: source.sourceType, note: 'Preview not available for this source type in Phase 1' },
  });
};

export const discoverMcrSources = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  await sourceRouterService.discoverSources(channelId);
  const snap = await sourceRouterService.getSnapshot(channelId);
  res.json({ success: true, data: snap });
};

export const addMcrSource = async (req: AuthRequest, res: Response) => {
  const channelId = String(req.params.channelId);
  const body = req.body as AddMcrSourceInput;
  if (!body?.label || !body?.sourceType) {
    res.status(400).json({ success: false, error: 'label and sourceType required' });
    return;
  }
  const source = await sourceRouterService.addSource(channelId, body, operatorFromReq(req));
  res.status(201).json({ success: true, data: source });
};

export const listIngestPublishers = async (req: AuthRequest, res: Response) => {
  const publishers = await mcrIngestService.listPublishers();
  res.json({ success: true, data: publishers });
};

export const createIngestKey = async (req: AuthRequest, res: Response) => {
  const { label, streamKey } = req.body as { label?: string; streamKey?: string };
  if (!label?.trim()) {
    res.status(400).json({ success: false, error: 'label required' });
    return;
  }
  const host = req.get('host') ?? undefined;
  const pub = await mcrIngestService.createIngestKey(label.trim(), streamKey?.trim());
  pub.publishUrl = mcrIngestService.getPublicPublishUrl(pub.streamKey, host?.split(':')[0]);
  res.status(201).json({ success: true, data: pub });
};

export const listAvailableChannels = async (_req: AuthRequest, res: Response) => {
  const channels = await prisma.channel.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      useBlueprint: true,
      isPlaylistChannel: true,
      blueprint: { select: { name: true } },
      playlist: { select: { name: true } },
    },
  });
  res.json({ success: true, data: channels });
};
