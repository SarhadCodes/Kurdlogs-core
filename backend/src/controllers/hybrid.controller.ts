import { Response } from 'express';
import { hybridChannelService } from '../services/hybridChannel.service';
import { AuthRequest, ApiResponse } from '../types';

export async function getHybridState(req: AuthRequest, res: Response) {
  const snapshot = await hybridChannelService.getSnapshot(String(req.params.channelId));
  const response: ApiResponse = { success: true, data: snapshot };
  res.json(response);
}

export async function updateHybridConfig(req: AuthRequest, res: Response) {
  const snapshot = await hybridChannelService.updateConfig(String(req.params.channelId), req.body);
  const response: ApiResponse = { success: true, data: snapshot };
  res.json(response);
}

export async function goLive(req: AuthRequest, res: Response) {
  const snapshot = await hybridChannelService.goLive(String(req.params.channelId));
  const response: ApiResponse = { success: true, data: snapshot, message: 'Now live' };
  res.json(response);
}

export async function returnToSchedule(req: AuthRequest, res: Response) {
  const snapshot = await hybridChannelService.returnToSchedule(String(req.params.channelId));
  const response: ApiResponse = { success: true, data: snapshot, message: 'Returned to blueprint schedule' };
  res.json(response);
}
