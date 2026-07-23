import { Request, Response } from 'express';
import { playlistService } from '../services/playlist.service';
import type { NormalizeCodecMode } from '../services/normalize.service';

function parseOptionalBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
    if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  }
  return defaultValue;
}

export const getAllPlaylists = async (req: Request, res: Response) => {
  const playlists = await playlistService.getAllPlaylists();
  res.json({ success: true, data: playlists });
};

export const getPlaylistById = async (req: Request, res: Response) => {
  const playlist = await playlistService.getPlaylistById(String(req.params.id));
  res.json({ success: true, data: playlist });
};

export const createPlaylist = async (req: Request, res: Response) => {
  const playlist = await playlistService.createPlaylist(req.body);
  res.status(201).json({ success: true, data: playlist });
};

export const updatePlaylist = async (req: Request, res: Response) => {
  const playlist = await playlistService.updatePlaylist(String(req.params.id), req.body);
  res.json({ success: true, data: playlist });
};

export const deletePlaylist = async (req: Request, res: Response) => {
  await playlistService.deletePlaylist(String(req.params.id));
  res.json({ success: true, message: 'Playlist deleted' });
};

export const addItem = async (req: Request, res: Response) => {
  let { videoPath, originalFilename, duration, normalize, normalizeCodec, brandProfileId } = req.body;
  
  if (req.file) {
    videoPath = req.file.path;
    originalFilename = req.file.originalname;
  }

  if (!videoPath) {
    return res.status(400).json({ success: false, error: 'videoPath or video file is required' });
  }

  const shouldNormalize = parseOptionalBoolean(normalize, true);
  const codecMode: NormalizeCodecMode = normalizeCodec === 'avc1' ? 'avc1' : 'legacy';
  const effectiveNormalize = codecMode === 'avc1' ? true : shouldNormalize;
  const item = await playlistService.addItem(
    String(req.params.id),
    videoPath,
    originalFilename,
    duration,
    effectiveNormalize,
    codecMode,
    brandProfileId || undefined
  );
  res.status(201).json({ success: true, data: item });
};

export const replaceItem = async (req: Request, res: Response) => {
  let { videoPath, originalFilename, brandProfileId } = req.body;

  if (req.file) {
    videoPath = req.file.path;
    originalFilename = req.file.originalname;
  }

  if (!videoPath) {
    return res.status(400).json({ success: false, error: 'videoPath or video file is required' });
  }

  const item = await playlistService.replaceItem(
    String(req.params.itemId),
    videoPath,
    originalFilename,
    brandProfileId || undefined
  );
  res.json({ success: true, data: item });
};

export const removeItem = async (req: Request, res: Response) => {
  await playlistService.removeItem(String(req.params.itemId));
  res.json({ success: true, message: 'Item removed' });
};

export const reorderItems = async (req: Request, res: Response) => {
  const { itemIds } = req.body; // Array of item IDs in new order
  await playlistService.reorderItems(String(req.params.id), itemIds);
  res.json({ success: true, message: 'Items reordered' });
};

export const updateItemLogo = async (req: Request, res: Response) => {
  let logoConfig: Record<string, unknown> = {};
  if (typeof req.body.logoConfig === 'string') {
    try {
      logoConfig = JSON.parse(req.body.logoConfig);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid logoConfig JSON' });
    }
  } else if (req.body.logoConfig && typeof req.body.logoConfig === 'object') {
    logoConfig = req.body.logoConfig;
  }

  if (req.file) {
    logoConfig.path = req.file.path;
  }

  const reburn = parseOptionalBoolean(req.body.reburn, true);
  const item = await playlistService.updateItemLogo(String(req.params.itemId), logoConfig as any, reburn);
  res.json({ success: true, data: item });
};

export const retryNormalize = async (req: Request, res: Response) => {
  const item = await playlistService.retryNormalize(String(req.params.itemId));
  res.json({ success: true, data: item });
};
