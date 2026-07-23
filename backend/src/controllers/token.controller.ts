import { Request, Response } from 'express';
import { tokenService } from '../services/token.service';

export const getAllTokens = async (req: Request, res: Response) => {
  const tokens = await tokenService.getAllTokens();
  res.json({ success: true, data: tokens });
};

export const getTokensForChannel = async (req: Request, res: Response) => {
  const tokens = await tokenService.getTokensForChannel(String(req.params.channelId));
  res.json({ success: true, data: tokens });
};

export const createToken = async (req: Request, res: Response) => {
  const { channelId, refreshIntervalMinutes } = req.body;
  const token = await tokenService.createToken(channelId, refreshIntervalMinutes);
  res.status(201).json({ success: true, data: token });
};

export const deleteToken = async (req: Request, res: Response) => {
  await tokenService.deleteToken(String(req.params.id));
  res.json({ success: true, message: 'Token deleted' });
};

export const refreshToken = async (req: Request, res: Response) => {
  const token = await tokenService.refreshToken(String(req.params.id));
  res.json({ success: true, data: token });
};

export const refreshAllTokens = async (req: Request, res: Response) => {
  await tokenService.refreshAllExpiring();
  res.json({ success: true, message: 'Triggered refresh for expiring tokens' });
};

export const validateStreamToken = async (req: Request, res: Response) => {
  let channelSlug = '';
  let token = '';

  const uri = req.header('X-Original-URI');
  if (uri) {
    const match = uri.match(/^\/secure\/hls\/([^/]+)\/([^/]+)\//);
    if (match) {
      token = match[1];
      channelSlug = match[2];
    }
  }
  
  if (!channelSlug || !token) {
    return res.status(403).send('Forbidden');
  }

  const isValid = await tokenService.validateToken(channelSlug, token);
  if (!isValid) {
    return res.status(403).send('Forbidden');
  }
  
  res.status(200).send('OK');
};
