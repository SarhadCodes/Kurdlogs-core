import { Request, Response } from 'express';
import { brandProfileService } from '../services/brandProfile.service';

export const listBrandProfiles = async (_req: Request, res: Response) => {
  const rows = await brandProfileService.getAll();
  res.json({ success: true, data: rows });
};

export const getBrandProfile = async (req: Request, res: Response) => {
  const row = await brandProfileService.getById(String(req.params.id));
  res.json({ success: true, data: row });
};

export const createBrandProfile = async (req: Request, res: Response) => {
  let body = { ...req.body };
  if (req.file) body.logoPath = req.file.path;
  const row = await brandProfileService.create(body);
  res.status(201).json({ success: true, data: row });
};

export const updateBrandProfile = async (req: Request, res: Response) => {
  let body = { ...req.body };
  if (req.file) body.logoPath = req.file.path;
  const row = await brandProfileService.update(String(req.params.id), body);
  res.json({ success: true, data: row });
};

export const deleteBrandProfile = async (req: Request, res: Response) => {
  const result = await brandProfileService.delete(String(req.params.id));
  res.json({ success: true, ...result });
};
