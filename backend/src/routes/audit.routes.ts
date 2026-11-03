import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';

export const auditRouter = Router();

// GET /api/audit?propertyId=...
auditRouter.get(
  '/',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  requirePropertyAccess('query', 'propertyId', true),
  async (req: Request, res: Response) => {
    try {
      const { propertyId, limit = '100', cursor } = req.query;
      const parsed = z.object({
        limit: z.string().regex(/^[0-9]{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(500)),
        cursor: z.string().min(1).max(100).optional(),
      }).safeParse({ limit, cursor });
      if (!parsed.success) return res.status(400).json({ error: 'Choose a whole-number limit from 1 to 500 and a valid cursor.' });

      const where: any = {};
      if (propertyId && propertyId !== 'all') {
        where.propertyId = String(propertyId);
      }

      const pageSize = parsed.data.limit;
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
