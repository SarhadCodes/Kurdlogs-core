import { Response } from 'express';
import crypto from 'crypto';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { graphicsAssetService } from '../services/graphics/graphicsAsset.service';
import { graphicsControlService } from '../services/graphics/graphicsControl.service';

const commandId = (value: unknown) => typeof value === 'string' && value.length >= 8 ? value : crypto.randomUUID();

export async function getGraphics(req: AuthRequest, res: Response) {
  res.json({ success: true, data: await graphicsControlService.get(String(req.params.channelId)) });
}

export async function saveGraphics(req: AuthRequest, res: Response) {
  const data = await graphicsControlService.save(String(req.params.channelId), req.body, req.user?.username);
  res.json({ success: true, data });
}

export async function publishGraphics(req: AuthRequest, res: Response) {
  const data = await graphicsControlService.publish(String(req.params.channelId), commandId(req.body?.commandId), req.user?.username);
  res.json({ success: true, data });
}

export async function setVisibility(req: AuthRequest, res: Response) {
  const visible = Boolean(req.body?.visible);
  const data = await graphicsControlService.setVisibility(String(req.params.channelId), visible, commandId(req.body?.commandId), req.user?.username);
  res.json({ success: true, data });
}

export async function listAssets(_req: AuthRequest, res: Response) {
  res.json({ success: true, data: await graphicsAssetService.list() });
}

export async function uploadAsset(req: AuthRequest, res: Response) {
  if (!req.file) throw new AppError('Graphics asset file is required', 400);
  res.status(201).json({ success: true, data: await graphicsAssetService.registerUpload(req.file) });
}
