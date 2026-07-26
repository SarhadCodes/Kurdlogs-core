import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { AuthRequest, TokenPayload } from '../types';
import { AppError } from './errorHandler';
import { extractAuthToken } from '../utils/authCookie';
import { enforceSecurityGate } from './securityGate';

async function loadUserFromToken(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  if (payload.purpose === 'mfa_pending') {
    throw new AppError('MFA verification required', 401, { code: 'MFA_REQUIRED' });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  return user;
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractAuthToken(req);

  if (!token) {
    return next(new AppError('Authentication required', 401));
  }

  try {
    req.user = await loadUserFromToken(token);
    return enforceSecurityGate(req, res, next);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError('Invalid or expired token', 403));
  }
};

/** Auth without password/MFA gate — for change-password and MFA setup routes. */
export const authenticateTokenSoft = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const token = extractAuthToken(req);

  if (!token) {
    return next(new AppError('Authentication required', 401));
  }

  try {
    req.user = await loadUserFromToken(token);
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError('Invalid or expired token', 403));
  }
};

export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const token = extractAuthToken(req);

  if (!token) {
    return next();
  }

  try {
    req.user = await loadUserFromToken(token);
  } catch {
    // Ignore error for optional auth
  }

  next();
};
