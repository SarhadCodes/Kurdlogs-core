import { Request, Response } from 'express';
import { blueprintService } from '../services/blueprint.service';
import type { SimulationResult } from '../types/blueprint.types';

export const listBlueprints = async (_req: Request, res: Response) => {
  const rows = await blueprintService.getAll();
  res.json({ success: true, data: rows });
};

export const getTemplates = async (_req: Request, res: Response) => {
  res.json({ success: true, data: blueprintService.getTemplates() });
};

export const getBlueprint = async (req: Request, res: Response) => {
  const row = await blueprintService.getById(String(req.params.id));
  res.json({ success: true, data: row });
};

export const createBlueprint = async (req: Request, res: Response) => {
  const { templateKey, name, description, blocks } = req.body;
  const row = templateKey
    ? await blueprintService.createFromTemplate(String(templateKey), name)
    : await blueprintService.create({ name, description, blocks });
  res.status(201).json({ success: true, data: row });
};

export const updateBlueprint = async (req: Request, res: Response) => {
  const row = await blueprintService.update(String(req.params.id), req.body);
  res.json({ success: true, data: row });
};

export const deleteBlueprint = async (req: Request, res: Response) => {
  const result = await blueprintService.delete(String(req.params.id));
  res.json({ success: true, ...result });
};

export const simulateBlueprint = async (req: Request, res: Response) => {
  const horizon = (req.body.horizon || req.query.horizon || '1h') as SimulationResult['horizon'];
  const allowed = ['1h', '24h', '7d'];
  const h = allowed.includes(horizon) ? horizon : '1h';
  const data = await blueprintService.simulate(String(req.params.id), h);
  res.json({ success: true, data });
};

export const getBlueprintSummary = async (req: Request, res: Response) => {
  const blocks = req.body?.blocks;
  const data = await blueprintService.getSummary(String(req.params.id), blocks);
  res.json({ success: true, data });
};

export const previewTimeline = async (req: Request, res: Response) => {
  const horizon = (req.query.horizon || '24h') as SimulationResult['horizon'];
  const allowed = ['1h', '24h', '7d'];
  const h = allowed.includes(horizon) ? horizon : '24h';
  const debug = req.query.debug === '1';
  const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
  const row = await blueprintService.getById(String(req.params.id));
  const blocks = req.body?.blocks ?? row.blocks;
  const data = await blueprintService.simulateBlocks(
    blocks,
    h,
    String(req.params.id),
    channelId ?? row.channel?.id,
    debug
  );
  res.json({ success: true, data });
};

export const getLiveCursor = async (req: Request, res: Response) => {
  const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
  const horizon = (req.query.horizon || '24h') as SimulationResult['horizon'];
  const allowed = ['1h', '24h', '7d'];
  const h = allowed.includes(horizon) ? horizon : '24h';
  const row = await blueprintService.getById(String(req.params.id));
  const resolvedChannelId = channelId ?? row.channel?.id;
  if (!resolvedChannelId) {
    return res.status(400).json({ success: false, error: 'channelId required — link blueprint to a channel' });
  }
  const data = await blueprintService.getLiveCursor(String(req.params.id), resolvedChannelId, undefined, h);
  res.json({ success: true, data });
};

export const getCachedTimeline = async (req: Request, res: Response) => {
  const horizon = (req.query.horizon || '24h') as SimulationResult['horizon'];
  const allowed = ['1h', '24h', '7d'];
  const h = allowed.includes(horizon) ? horizon : '24h';
  const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
  const data = await blueprintService.getCachedTimeline(String(req.params.id), h, channelId);
  res.json({ success: true, data });
};

export const verifyObservers = async (req: Request, res: Response) => {
  const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
  const horizon = (req.query.horizon || '24h') as SimulationResult['horizon'];
  const allowed = ['1h', '24h', '7d'];
  const h = allowed.includes(horizon) ? horizon : '24h';
  const row = await blueprintService.getById(String(req.params.id));
  const resolvedChannelId = channelId ?? row.channel?.id;
  if (!resolvedChannelId) {
    return res.status(400).json({ success: false, error: 'channelId required' });
  }
  const data = await blueprintService.verifyObservers(String(req.params.id), resolvedChannelId, h);
  res.json({ success: true, data });
};

export const verifySync = async (req: Request, res: Response) => {
  const channelId = req.query.channelId ? String(req.query.channelId) : undefined;
  const horizon = (req.query.horizon || '24h') as SimulationResult['horizon'];
  const allowed = ['1h', '24h', '7d'];
  const h = allowed.includes(horizon) ? horizon : '24h';
  const row = await blueprintService.getById(String(req.params.id));
  const resolvedChannelId = channelId ?? row.channel?.id;
  if (!resolvedChannelId) {
    return res.status(400).json({ success: false, error: 'channelId required' });
  }
  const data = await blueprintService.verifySync(String(req.params.id), resolvedChannelId, h);
  res.json({ success: true, data });
};

export const verifyBlueprintExecution = async (req: Request, res: Response) => {
  const row = await blueprintService.getById(String(req.params.id));
  const blocks = req.body?.blocks ?? row.blocks;
  const count = Math.min(parseInt(String(req.query.count || '48'), 10), 200);
  const report = await blueprintService.verifyTimelineExecution(
    blueprintService.parseBlocksFromJson(blocks),
    count,
    row.channel?.id,
    String(req.params.id)
  );
  res.json({ success: true, data: report });
};

export const verifyExecutionConsistency = async (req: Request, res: Response) => {
  const row = await blueprintService.getById(String(req.params.id));
  const blocks = req.body?.blocks ?? row.blocks;
  const countsParam = String(req.query.counts || '48,96,500');
  const segmentCounts = countsParam
    .split(',')
    .map((n) => parseInt(n.trim(), 10))
    .filter((n) => n > 0 && n <= 8000);
  const report = await blueprintService.verifyExecutionConsistency(
    blueprintService.parseBlocksFromJson(blocks),
    row.channel?.id,
    String(req.params.id),
    segmentCounts.length ? segmentCounts : [48, 96, 500]
  );
  res.json({ success: true, data: report });
};

export const previewBlueprint = async (req: Request, res: Response) => {
  const count = Math.min(parseInt(String(req.query.count || '12'), 10), 100);
  const data = await blueprintService.previewNext(String(req.params.id), count);
  res.json({ success: true, data });
};

export const publishBlueprint = async (req: Request, res: Response) => {
  const { channelId, blocks } = req.body;
  if (!channelId) {
    return res.status(400).json({ success: false, error: 'channelId is required' });
  }
  const data = await blueprintService.publishToChannel(
    String(req.params.id),
    String(channelId),
    blocks
  );
  res.json({ success: true, data });
};
