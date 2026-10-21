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
    if (typeof req.query.propertyId !== 'string' || !req.query.propertyId.trim()) return res.status(400).json({ error: 'Property ID is required.' });
    const propertyId = req.query.propertyId;
    const filter = z.enum(['true', 'false']).optional().safeParse(req.query.includeInactive);
    if (!filter.success) return res.status(400).json({ error: 'Invalid catalogue filter.' });
    const includeInactive = filter.data === 'true';
    if (includeInactive && !['GLOBAL_ADMIN', 'PROPERTY_MANAGER'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'Only administrators and property managers can manage archived activities.' });
    }

    const [categories, items] = await Promise.all([
      prisma.category.findMany({
        where: { propertyId },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.item.findMany({
        where: { propertyId, ...(includeInactive ? {} : { isActive: true }) },
        include: { category: true, _count: { select: { billItems: true } } },
        orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      }),
    ]);

    return res.json({ categories, items: items.filter(item => item.category.propertyId === propertyId).map(({ _count, ...item }) => ({ ...item, hasBillHistory: _count.billItems > 0 })) });
  } catch (error) {
    console.error('Fetch items error:', error);
    return res.status(500).json({ error: 'Failed to fetch items catalogue.' });
  }
});

// Create the first catalogue category for a property that has not been set up yet.
itemsRouter.post(
  '/categories',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  requirePropertyAccess('body', 'propertyId'),
  async (req: Request, res: Response) => {
    const result = z.object({ propertyId: z.string().min(1), name: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Enter a category name of 1–80 characters.' });
    try {
      const { propertyId, name } = result.data;
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return res.status(404).json({ error: 'Property not found.' });
      const last = await prisma.category.aggregate({ where: { propertyId }, _max: { sortOrder: true } });
      const category = await prisma.category.create({ data: { propertyId, name, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
      await logAuditEvent({ req, propertyId, action: 'CATEGORY_CREATE', targetType: 'Category', targetId: category.id, details: { name } });
      return res.status(201).json({ category });
    } catch (error: any) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'A category with this name already exists in this property.' });
      console.error('Create category error:', error);
      return res.status(500).json({ error: 'Could not create the category. Please try again.' });
    }
  }
);

const commissionRoles = ['seller', 'guide', 'instructor', 'photo', 'video'];
const validRates = (value: string) => {
  if (!value.trim()) return true;
  try {
    const rates = JSON.parse(value);
    return rates !== null && typeof rates === 'object' && !Array.isArray(rates) && Object.entries(rates).every(([role, amount]) => commissionRoles.includes(role) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0);
  } catch { return false; }
};
const activityFields = z.object({
  categoryId: z.string().trim().min(1),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(2).max(200),
  price: z.number().finite().nonnegative(),
  poolType: z.enum(['COURSE_POOL', 'DIVE_POOL', 'NONE']).default('NONE'),
  poolContribution: z.number().finite().min(0).default(0.0),
  personalRoles: z.string().max(100).refine(value => value.split(',').every(role => !role.trim() || commissionRoles.includes(role.trim())), 'Choose supported commission roles.').optional().nullable(),
  personalRatesJson: z.string().max(2000).refine(validRates, 'Enter a JSON object with nonnegative amounts for supported commission roles.').optional().nullable(),
});
const itemSchema = activityFields.extend({ propertyId: z.string().trim().min(1) }).strict();
const itemUpdateSchema = activityFields.partial().extend({ isActive: z.boolean().optional() }).strict().refine(data => Object.keys(data).length > 0, 'Choose an activity field to update.');

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
        const issue = parseResult.error.issues[0];
        return res.status(400).json({ error: `Invalid ${issue.path.join('.') || 'activity'}: ${issue.message}`, details: parseResult.error.errors });
      }

      const data = parseResult.data;
      const category = await prisma.category.findFirst({ where: { id: data.categoryId, propertyId: data.propertyId } });
      if (!category) return res.status(400).json({ error: 'Choose a category from this property.' });
      const existing = await prisma.item.findFirst({
        where: { propertyId: data.propertyId, code: data.code },
      });
      if (existing) {
        return res.status(409).json({ error: 'An activity with this code already exists in this property, including archived activities.' });
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
    } catch (error: any) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'An activity with this code already exists in this property, including archived activities.' });
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
      const existing = await prisma.item.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
      if (!existing) {
        return res.status(404).json({ error: 'Item not found.' });
      }

      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) {
        return res.status(403).json({ error: 'Unauthorized for this property.' });
      }

      if (existing.property?.deletedAt) return res.status(410).json({ error: 'This property has been removed. Its records are read-only.' });

      const parsed = itemUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return res.status(400).json({ error: `Invalid ${issue.path.join('.') || 'activity'}: ${issue.message}`, details: parsed.error.errors });
      }
      const data = parsed.data;

      const effectiveCategoryId = data.categoryId ?? existing.categoryId;
      const category = typeof effectiveCategoryId === 'string' && await prisma.category.findFirst({ where: { id: effectiveCategoryId, propertyId: existing.propertyId } });
      if (!category) return res.status(400).json({ error: 'Choose a category from this property.' });

      // Payroll reads pool rules from the activity; keep rules used by saved bills stable.
      const poolRulesChanged = (data.poolType !== undefined && data.poolType !== existing.poolType) || (data.poolContribution !== undefined && data.poolContribution !== existing.poolContribution);
      if (poolRulesChanged && await prisma.billItem.count({ where: { itemId: id } })) {
        return res.status(409).json({ error: 'This activity is used on saved bills. Create a new activity to change pool rules without changing historical payroll.' });
      }

      const updated = await prisma.item.update({
        where: { id },
        data,
        include: { category: true },
      });

      await logAuditEvent({
        req,
        propertyId: updated.propertyId,
        action: data.isActive === true && !existing.isActive ? 'ITEM_RESTORE' : data.isActive === false && existing.isActive ? 'ITEM_DELETE' : 'ITEM_UPDATE',
        targetType: 'Item',
        targetId: updated.id,
        details: { code: updated.code, name: updated.name, price: updated.price, isActive: updated.isActive, previousPrice: existing.price },
      });

      return res.json({ item: updated });
    } catch (error: any) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'An activity with this code already exists in this property, including archived activities.' });
      console.error('Update item error:', error);
      return res.status(500).json({ error: 'Failed to update item.' });
    }
  }
);

// Removing an activity disables it for new bills and keeps existing bill/commission records.
itemsRouter.delete('/:id', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.item.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
    if (!existing) return res.status(404).json({ error: 'Activity not found.' });
    if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) return res.status(403).json({ error: 'Unauthorized for this property.' });
    if (existing.property.deletedAt) return res.status(410).json({ error: 'This property has been removed. Its records are read-only.' });
    const item = await prisma.item.update({ where: { id }, data: { isActive: false } });
    if (existing.isActive) await logAuditEvent({ req, propertyId: item.propertyId, action: 'ITEM_DELETE', targetType: 'Item', targetId: id, details: { code: item.code, name: item.name, historyRetained: true } });
    return res.json({ message: 'Activity removed from new bills. Existing bills and history have been retained.', item });
  } catch {
    console.error('Delete activity failed.');
    return res.status(500).json({ error: 'Could not delete this activity. Please try again.' });
  }
});
