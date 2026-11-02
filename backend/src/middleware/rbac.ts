import { Request, Response, NextFunction } from 'express';

// Check if user has one of the allowed roles
export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden. Role '${req.user.role}' does not have permission to perform this action.`,
      });
    }

    next();
  };
};

// Check if user has permission to access the given propertyId
export const requirePropertyAccess = (propertyIdSource: 'query' | 'body' | 'params' = 'query', fieldName = 'propertyId', allowAll = false) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    }

    // Authorize the exact selector consumed by the handler, never a fallback header.
    const propertyId = req[propertyIdSource]?.[fieldName];
    if (req.user.role === 'GLOBAL_ADMIN' && allowAll && (propertyId === undefined || propertyId === 'all')) return next();
    if (typeof propertyId !== 'string' || !propertyId.trim() || propertyId.length > 100) {
      return res.status(400).json({ error: 'Property ID is required for this operation.' });
    }
    if (req.user.role === 'GLOBAL_ADMIN') return next();

    // Centre Staff and Property Managers can only access their assigned properties
    if (!req.user.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({
        error: 'Access denied. You do not have permissions for this dive centre.',
      });
    }

    next();
  };
};
