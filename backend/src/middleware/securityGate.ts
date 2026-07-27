import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { AppError } from './errorHandler';

/** Soft gate: only block when a user was explicitly flagged to change password. */
export const enforceSecurityGate = (req: AuthRequest, _res: Response, next: NextFunction) => {
  const user = req.user;
  if (!user) return next();

  const path = (req.originalUrl || req.url || '').split('?')[0];
  const method = req.method.toUpperCase();

  const isMe = method === 'GET' && /\/auth\/me\/?$/.test(path);
  const isLogout = method === 'POST' && /\/auth\/logout\/?$/.test(path);
  const isChangePassword = method === 'PUT' && /\/auth\/change-password\/?$/.test(path);

  if (user.mustChangePassword) {
    if (isMe || isLogout || isChangePassword) return next();
    return next(
      new AppError('Password change required before continuing', 403, {
        code: 'PASSWORD_CHANGE_REQUIRED',
      })
    );
  }

  return next();
};
