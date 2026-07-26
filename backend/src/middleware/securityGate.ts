import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { AppError } from './errorHandler';
import { rolesRequiringMfa } from '../utils/mfa';

/** Block panel use until password change / MFA enrollment completes. */
export const enforceSecurityGate = (req: AuthRequest, _res: Response, next: NextFunction) => {
  const user = req.user;
  if (!user) return next();

  const path = (req.originalUrl || req.url || '').split('?')[0];
  const method = req.method.toUpperCase();

  const isMe = method === 'GET' && /\/auth\/me\/?$/.test(path);
  const isLogout = method === 'POST' && /\/auth\/logout\/?$/.test(path);
  const isChangePassword = method === 'PUT' && /\/auth\/change-password\/?$/.test(path);
  const isMfaSetup = method === 'POST' && /\/auth\/mfa\/(setup|enable)\/?$/.test(path);

  if (user.mustChangePassword) {
    if (isMe || isLogout || isChangePassword) return next();
    return next(
      new AppError('Password change required before continuing', 403, {
        code: 'PASSWORD_CHANGE_REQUIRED',
      })
    );
  }

  if (rolesRequiringMfa(user.role) && !user.mfaEnabled) {
    if (isMe || isLogout || isChangePassword || isMfaSetup) return next();
    return next(
      new AppError('Multi-factor authentication setup required', 403, {
        code: 'MFA_SETUP_REQUIRED',
      })
    );
  }

  return next();
};
