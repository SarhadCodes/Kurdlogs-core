import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { AppError } from './errorHandler';
import { sourceRouterService } from '../services/sourceRouter.service';

/** Operator, Supervisor, and Admin may control MCR program output. */
export const requireOperator = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }
  if (!sourceRouterService.canControl(req.user.role)) {
    return next(new AppError('Operator access required', 403));
  }
  next();
};
