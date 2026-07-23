import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { boostService } from '../services/boost.service';
import { AppError } from '../middleware/errorHandler';

export const listBoostNodes = async (_req: Request, res: Response) => {
  const [nodes, summary] = await Promise.all([
    boostService.listNodes(),
    boostService.getSummary(),
  ]);
  res.json({ success: true, data: { nodes, summary } });
};

export const createBoostNode = async (req: Request, res: Response) => {
  const node = await boostService.createNode(req.body);
  res.status(201).json({ success: true, data: node });
};

export const updateBoostNode = async (req: Request, res: Response) => {
  const node = await boostService.updateNode(String(req.params.id), req.body);
  res.json({ success: true, data: node });
};

export const deleteBoostNode = async (req: Request, res: Response) => {
  await boostService.deleteNode(String(req.params.id));
  res.json({ success: true, message: 'Boost node removed' });
};

export const regenerateBoostNodeKey = async (req: Request, res: Response) => {
  const node = await boostService.regenerateSecret(String(req.params.id));
  res.json({ success: true, data: node });
};

export const workerHeartbeat = async (req: Request, res: Response) => {
  const secretKey = boostService.extractWorkerKey(req);
  if (!secretKey) {
    throw new AppError('Boost node key required (X-Boost-Key header)', 401);
  }

  const result = await boostService.workerHeartbeat(secretKey, req.body || {});
  res.json({ success: true, data: result });
};

export const getBoostInstallScript = (_req: Request, res: Response) => {
  const scriptPath = path.join(__dirname, '../../scripts/boost-worker-install.sh');
  if (!fs.existsSync(scriptPath)) {
    throw new AppError('Install script not found', 404);
  }

  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="boost-worker-install.sh"');
  res.send(fs.readFileSync(scriptPath, 'utf8'));
};
