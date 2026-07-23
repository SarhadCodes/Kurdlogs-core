import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { AppError } from './errorHandler';

export function getIptvApiKeyFromRequest(req: Request): string | undefined {
  const header = req.headers['x-iptv-key'];
  if (typeof header === 'string' && header) return header;
  const query = req.query.api_key;
  if (typeof query === 'string' && query) return query;
  return undefined;
}

export function validateIptvApiKey(req: Request, res: Response, next: NextFunction) {
  const key = getIptvApiKeyFromRequest(req);
  if (!key || key !== env.IPTV_API_KEY) {
    return next(new AppError('Invalid IPTV API key', 403));
  }
  next();
}
