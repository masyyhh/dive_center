import { validationIssues } from '../utils/validation';
import { withPropertyPayrollTransaction } from '../utils/payrollTransaction';
import { CatalogueError, nextItemCode } from '../services/catalogueTransfer';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';
import { validPoolRate } from '../utils/poolRates';
import { itemSchema, itemUpdateSchema } from './catalogue.validation';

export function registerCatalogueReadRoutes(itemsRouter: Router) {
  itemsRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
    try {
      if(typeof req.query.propertyId !== 'string' || !req.query.propertyId.trim()) return res.status(400).json({ error: 'Property ID is required.' });
      const propertyId = req.query.propertyId;
      const filter = z.enum(['true', 'false']).optional().safeParse(req.query.includeInactive);
      if(!filter.success) return res.status(400).json({ error: 'Invalid catalogue filter.' });
      const includeInactive = filter.data === 'true';
      if(includeInactive && !['GLOBAL_ADMIN', 'PROPERTY_MANAGER'].includes(req.user!.role)) {
        return res.status(403).json({ error: 'Only administrators and property managers can manage archived activities.' });
      }

      const [categories, items] = await Promise.all([
        prisma.category.findMany({
          where: { propertyId },
          orderBy: { sortOrder: 'asc' },
        }),
        prisma.item.findMany({
          where: { propertyId, ...(includeInactive ? {} : { isActive: true }) },
          include: { category: true, _count: { select: { billItems: true, packageItems: true } } },
          orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
        }),
      ]);

      return res.json({ categories, items: items.filter(item => item.category.propertyId === propertyId).map(({ _count, ...item }) => ({ ...item, hasBillHistory: _count.billItems > 0, hasPackageUsage: _count.packageItems > 0 })) });
    } catch(error) {
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
      if(!result.success) return res.status(400).json({ error: 'Enter a category name of 1–80 characters.' });
      try {
        const { propertyId, name } = result.data;
        const property = await prisma.property.findUnique({ where: { id: propertyId } });
        if(!property) return res.status(404).json({ error: 'Property not found.' });
        if(property.deletedAt) return res.status(410).json({ error: 'This property has been removed. Its records are read-only.' });
        if(!property.isActive) return res.status(400).json({ error: 'Select an active property.' });
        const last = await prisma.category.aggregate({ where: { propertyId }, _max: { sortOrder: true } });
        const category = await prisma.category.create({ data: { propertyId, name, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
        await logAuditEvent({ req, propertyId, action: 'CATEGORY_CREATE', targetType: 'Category', targetId: category.id, details: { name } });
        return res.status(201).json({ category });
      } catch(error: any) {
        if(error?.code === 'P2002') return res.status(409).json({ error: 'A category with this name already exists in this property.' });
        console.error('Create category error:', error);
        return res.status(500).json({ error: 'Could not create the category. Please try again.' });
      }
    }
  );

}

export function registerCatalogueWriteRoutes(itemsRouter: Router) {
  // POST /api/items (GLOBAL_ADMIN or PROPERTY_MANAGER)
  itemsRouter.post(
    '/',
    requireAuth,
    requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
    requirePropertyAccess('body', 'propertyId'),
    async (req: Request, res: Response) => {
      try {
        const parseResult = itemSchema.safeParse(req.body);
        if(!parseResult.success) {
          const issue = parseResult.error.issues[0];
          return res.status(400).json({ error: `Invalid ${issue.path.join('.') || 'activity'}: ${issue.message}`, details: validationIssues(parseResult.error) });
        }

        const data = parseResult.data;
        const item = await withPropertyPayrollTransaction(prisma, data.propertyId, async tx => {
          const category = await tx.category.findFirst({ where: { id: data.categoryId, propertyId: data.propertyId } });
          if(!category) throw new CatalogueError('Choose a category from this property.');
          const property = await tx.property.findUnique({ where: { id: data.propertyId } });
          if(!property?.isActive || property.deletedAt) throw new CatalogueError('Select an active property.');
          const code = data.code || await nextItemCode(tx, data.propertyId, category.name);
          return tx.item.create({ data: { ...data, code }, include: { category: true } });
        });

        await logAuditEvent({
          req,
          propertyId: item.propertyId,
          action: 'ITEM_CREATE',
          targetType: 'Item',
          targetId: item.id,
          details: { code: item.code, name: item.name, price: item.price, includesComplimentaryMedia: item.includesComplimentaryMedia },
        });

        return res.status(201).json({ item });
      } catch(error: any) {
        if(error?.code === 'P2002') return res.status(409).json({ error: 'An activity with this code already exists in this property, including archived activities.' });
        if(error instanceof CatalogueError) return res.status(400).json({ error: error.message });
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
        if(!existing) {
          return res.status(404).json({ error: 'Item not found.' });
        }

        if(req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) {
          return res.status(403).json({ error: 'Unauthorized for this property.' });
        }

        if(existing.property?.deletedAt) return res.status(410).json({ error: 'This property has been removed. Its records are read-only.' });

        const parsed = itemUpdateSchema.safeParse(req.body);
        if(!parsed.success) {
          const issue = parsed.error.issues[0];
          return res.status(400).json({ error: `Invalid ${issue.path.join('.') || 'activity'}: ${issue.message}`, details: validationIssues(parsed.error) });
        }
        const data = parsed.data;
        if(data.code !== undefined && data.code !== existing.code) return res.status(400).json({ error: 'Item codes cannot be changed after creation.' });

        const effectiveCategoryId = data.categoryId ?? existing.categoryId;
        const category = typeof effectiveCategoryId === 'string' && await prisma.category.findFirst({ where: { id: effectiveCategoryId, propertyId: existing.propertyId } });
        if(!category) return res.status(400).json({ error: 'Choose a category from this property.' });

        // Keep rules stable for billed activities, including retained legacy records.
        if(!validPoolRate(data.poolType ?? existing.poolType, data.poolContribution ?? existing.poolContribution)) {
          return res.status(400).json({ error: 'Course and dive pool rates must be between 0 and 100 percent.' });
        }
        const poolRulesChanged = (data.poolType !== undefined && data.poolType !== existing.poolType) || ((data.poolType ?? existing.poolType) !== 'NONE' && data.poolContribution !== undefined && data.poolContribution !== existing.poolContribution);
        if(poolRulesChanged && await prisma.billItem.count({ where: { itemId: id } })) {
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
          details: { code: updated.code, name: updated.name, price: updated.price, isActive: updated.isActive, previousPrice: existing.price, includesComplimentaryMedia: updated.includesComplimentaryMedia, previousIncludesComplimentaryMedia: existing.includesComplimentaryMedia },
        });

        return res.json({ item: updated });
      } catch(error: any) {
        if(error?.code === 'P2002') return res.status(409).json({ error: 'An activity with this code already exists in this property, including archived activities.' });
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
      if(!existing) return res.status(404).json({ error: 'Activity not found.' });
      if(req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) return res.status(403).json({ error: 'Unauthorized for this property.' });
      if(existing.property.deletedAt) return res.status(410).json({ error: 'This property has been removed. Its records are read-only.' });
      const item = await prisma.item.update({ where: { id }, data: { isActive: false } });
      if(existing.isActive) await logAuditEvent({ req, propertyId: item.propertyId, action: 'ITEM_DELETE', targetType: 'Item', targetId: id, details: { code: item.code, name: item.name, historyRetained: true } });
      return res.json({ message: 'Activity removed from new bills. Existing bills and history have been retained.', item });
    } catch {
      console.error('Delete activity failed.');
      return res.status(500).json({ error: 'Could not delete this activity. Please try again.' });
    }
  });

}
