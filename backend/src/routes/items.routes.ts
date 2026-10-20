import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';

export const itemsRouter = Router();

// GET /api/items?propertyId=...
itemsRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.query.propertyId);

    const [categories, items] = await Promise.all([
      prisma.category.findMany({
        where: { propertyId },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.item.findMany({
        where: { propertyId, isActive: true },
        include: { category: true },
        orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      }),
    ]);

    return res.json({ categories, items });
  } catch (error) {
    console.error('Fetch items error:', error);
    return res.status(500).json({ error: 'Failed to fetch items catalogue.' });
  }
});

const itemSchema = z.object({
  propertyId: z.string(),
  categoryId: z.string(),
  code: z.string().min(1),
  name: z.string().min(2),
  price: z.number().positive(),
  poolType: z.enum(['COURSE_POOL', 'DIVE_POOL', 'NONE']).default('NONE'),
  poolContribution: z.number().min(0).default(0.0),
  personalRoles: z.string().optional().nullable(),
  personalRatesJson: z.string().optional().nullable(),
});

// POST /api/items (GLOBAL_ADMIN or PROPERTY_MANAGER)
itemsRouter.post(
  '/',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  requirePropertyAccess('body', 'propertyId'),
  async (req: Request, res: Response) => {
    try {
      const parseResult = itemSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
      }

      const data = parseResult.data;
      const existing = await prisma.item.findFirst({
        where: { propertyId: data.propertyId, code: data.code },
      });
      if (existing) {
        return res.status(400).json({ error: `An item with code '${data.code}' already exists in this centre.` });
      }

      const item = await prisma.item.create({
        data,
        include: { category: true },
      });

      await logAuditEvent({
        req,
        propertyId: item.propertyId,
        action: 'ITEM_CREATE',
        targetType: 'Item',
        targetId: item.id,
        details: { code: item.code, name: item.name, price: item.price },
      });

      return res.status(201).json({ item });
    } catch (error) {
      console.error('Create item error:', error);
      return res.status(500).json({ error: 'Failed to create item.' });
    }
  }
);

// PUT /api/items/:id
itemsRouter.put(
  '/:id',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const existing = await prisma.item.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: 'Item not found.' });
      }

      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) {
        return res.status(403).json({ error: 'Unauthorized for this property.' });
      }

      const { name, price, categoryId, poolType, poolContribution, personalRoles, personalRatesJson, isActive } =
        req.body;

      const updated = await prisma.item.update({
        where: { id },
        data: {
          name: name ?? undefined,
          price: price !== undefined ? Number(price) : undefined,
          categoryId: categoryId ?? undefined,
          poolType: poolType ?? undefined,
          poolContribution: poolContribution !== undefined ? Number(poolContribution) : undefined,
          personalRoles: personalRoles !== undefined ? personalRoles : undefined,
          personalRatesJson: personalRatesJson !== undefined ? personalRatesJson : undefined,
          isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        },
        include: { category: true },
      });

      await logAuditEvent({
        req,
        propertyId: updated.propertyId,
        action: 'ITEM_UPDATE',
        targetType: 'Item',
        targetId: updated.id,
        details: { name: updated.name, price: updated.price },
      });

      return res.json({ item: updated });
    } catch (error) {
      console.error('Update item error:', error);
      return res.status(500).json({ error: 'Failed to update item.' });
    }
  }
);
