import { Request, Response, NextFunction } from 'express';
import { logAuditEvent } from '../services/auditService';

// Capture activity without storing request bodies, query values, or credentials.
export const auditApiActivity = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = new Date();
  const path = req.originalUrl.split('?')[0];
  if (['/api/health', '/api/ready'].includes(path)) return next();
  res.once('finish', () => {
    void logAuditEvent({
      req,
      action: 'API_REQUEST',
      targetType: 'ApiRequest',
      details: {
        method: req.method,
        path,
        status: res.statusCode,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
  });
  next();
};
