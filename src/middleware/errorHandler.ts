import { UserError } from '../modules/user/error.js';
import { logger } from '../infrastructure/logger.js';
import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {

  if (err instanceof SyntaxError && 'body' in err) {
    logger.warn('SyntaxError', {
      message: err.message,
      path: req.path,
      method: req.method,
    });

    return res.status(400).json({
      error: 'Invalid JSON payload',
      message: err.message,
    });
  }

  if (err instanceof UserError) {
    logger.warn('UserError', {
      message: err.message,
      code: err.code,
      status: err.status,
      meta: err.meta,
      path: req.path,
      method: req.method,
    });

    return res.status(err.status).json({
      error: err.message,
      status: err.status,
      code: err.code,
    });
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({ error: 'Internal server error' });
};