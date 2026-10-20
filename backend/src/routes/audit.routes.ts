import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';

export const auditRouter = Router();

// GET /api/audit?propertyId=...
auditRouter.get(
  '/',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  requirePropertyAccess('query', 'propertyId'),
  async (req: Request, res: Response) => {
    try {
      const { propertyId, limit = '100' } = req.query;

      const where: any = {};
      if (propertyId && propertyId !== 'all') {
        where.propertyId = String(propertyId);
      }

      const logs = await prisma.auditLog.findMany({
        where,
        take: parseInt(String(limit), 10) || 100,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          property: { select: { id: true, name: true, code: true } },
        },
      });

      return res.json({ logs });
    } catch (error) {
      console.error('Fetch audit log error:', error);
      return res.status(500).json({ error: 'Failed to fetch audit log.' });
    }
  }
);
