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
      const { propertyId, limit = '100', cursor } = req.query;

      const where: any = {};
      if (propertyId && propertyId !== 'all') {
        where.propertyId = String(propertyId);
      }

      const pageSize = Math.min(500, Math.max(1, parseInt(String(limit), 10) || 100));
      const logs = await prisma.auditLog.findMany({
        where,
        take: pageSize + 1,
        ...(typeof cursor === 'string' && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
          property: { select: { id: true, name: true, code: true } },
        },
      });

      const hasMore = logs.length > pageSize;
      const page = logs.slice(0, pageSize);
      return res.json({ logs: page, nextCursor: hasMore ? page[page.length - 1].id : null });
    } catch (error) {
      console.error('Fetch audit log error:', error);
      return res.status(500).json({ error: 'Failed to fetch audit log.' });
    }
  }
);
