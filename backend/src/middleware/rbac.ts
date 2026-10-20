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
export const requirePropertyAccess = (propertyIdSource: 'query' | 'body' | 'params' = 'query', fieldName = 'propertyId') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    }

    // Global Admin has access to all properties
    if (req.user.role === 'GLOBAL_ADMIN') {
      return next();
    }

    const propertyId =
      req[propertyIdSource]?.[fieldName] ||
      req.headers['x-property-id'] ||
      req.query[fieldName] ||
      req.body?.[fieldName];

    if (!propertyId || typeof propertyId !== 'string') {
      return res.status(400).json({ error: 'Property ID is required for this operation.' });
    }

    // Centre Staff and Property Managers can only access their assigned properties
    if (!req.user.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({
        error: 'Access denied. You do not have permissions for this dive centre.',
      });
    }

    next();
  };
};
