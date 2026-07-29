import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from './errorHandler';

/** Graphics mutations are operational controls; viewers remain read-only. */
export function requireGraphicsOperator(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!req.user || req.user.role === 'VIEWER') {
    next(new AppError('Graphics operator permission required', 403));
    return;
  }
  next();
}
