import { Request, Response } from 'express';
import { overlayService } from '../services/overlay.service';

export const getOverlaysForChannel = async (req: Request, res: Response) => {
  const overlays = await overlayService.getOverlaysForChannel(String(req.params.channelId));
  res.json({ success: true, data: overlays });
};

export const createOverlay = async (req: Request, res: Response) => {
  let data = req.body;
  if (typeof data.config === 'string') data.config = JSON.parse(data.config);
  if (typeof data.isActive === 'string') data.isActive = data.isActive === 'true';
  
  if (req.file) {
    data.config = data.config || {};
    data.config.path = req.file.path;
  }

  const overlay = await overlayService.createOverlay(String(req.params.channelId), data);
  res.status(201).json({ success: true, data: overlay });
};

export const updateOverlay = async (req: Request, res: Response) => {
  let data = req.body;
  if (typeof data.config === 'string') data.config = JSON.parse(data.config);
  if (typeof data.isActive === 'string') data.isActive = data.isActive === 'true';

  if (req.file) {
    data.config = data.config || {};
    data.config.path = req.file.path;
  }

  const overlay = await overlayService.updateOverlay(String(req.params.id), data);
  res.json({ success: true, data: overlay });
};

export const deleteOverlay = async (req: Request, res: Response) => {
  const result = await overlayService.deleteOverlay(String(req.params.id));
  res.json({ success: true, ...result });
};
