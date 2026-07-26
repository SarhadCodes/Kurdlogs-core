import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from './errorHandler';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

type AttemptState = { fails: number; lockedUntil: number };

const attempts = new Map<string, AttemptState>();

function clientKey(req: Request): string {
  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : null) ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown';
  const username =
    typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  return `${ip}|${username || '*'}`;
}

export function assertNotLocked(req: Request): void {
  const state = attempts.get(clientKey(req));
  if (state && state.lockedUntil > Date.now()) {
    const retrySec = Math.ceil((state.lockedUntil - Date.now()) / 1000);
    throw new AppError(`Too many failed attempts. Try again in ${retrySec}s`, 429);
  }
}

export function recordLoginFailure(req: Request): void {
  const key = clientKey(req);
  const state = attempts.get(key) || { fails: 0, lockedUntil: 0 };
  state.fails += 1;
  if (state.fails >= MAX_FAILS) {
    state.lockedUntil = Date.now() + WINDOW_MS;
    state.fails = 0;
  }
  attempts.set(key, state);
}

export function clearLoginFailures(req: Request): void {
  attempts.delete(clientKey(req));
}

export const loginRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please try again later.' },
});

export function loginLockMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    assertNotLocked(req);
    next();
  } catch (err) {
    next(err);
  }
}
