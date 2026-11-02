import { positiveIntSchema } from '../utils/fields';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';
import { validationIssues } from '../utils/validation';

export const packagesRouter = Router();

const packageItemInputSchema = z.object({
  itemId: z.string().trim().min(1, 'Item ID is required.'),
  quantity: positiveIntSchema.default(1),
});

const packageItemsSchema = z.array(packageItemInputSchema).min(1, 'At least one service item must be included in the package.').max(50)
  .refine(items => {
    const quantities = new Map<string, number>();
    for (const item of items) {
      const total = (quantities.get(item.itemId) ?? 0) + item.quantity;
      if (total > 2147483647) return false;
      quantities.set(item.itemId, total);
    }
    return true;
  }, 'The combined quantity for each service cannot exceed 2147483647.');

const createPackageSchema = z.object({
  propertyId: z.string().trim().min(1, 'Property ID is required.'),
  name: z.string().trim().min(2, 'Package name must have at least 2 characters.').max(200),
  code: z.string().trim().min(2, 'Package code must have at least 2 characters.').max(50).transform(val => val.toUpperCase()),
  description: z.string().trim().max(1000).optional().nullable(),
  items: packageItemsSchema,
});

const updatePackageSchema = z.object({
  name: z.string().trim().min(2, 'Package name must have at least 2 characters.').max(200).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
  items: packageItemsSchema.optional(),
});

// GET /api/packages?propertyId=...
packagesRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.query.propertyId);
    const includeInactive = req.query.includeInactive === 'true' && (req.user!.role === 'GLOBAL_ADMIN' || req.user!.assignedPropertyIds.includes(propertyId));

    const packages = await prisma.divePackage.findMany({
      where: {
        propertyId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        items: {
          include: {
            item: {
              include: {
                category: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return res.json({ packages: packages.map(pkg => ({ ...pkg, price: pkg.items.reduce((sum, row) => sum + row.item.price * row.quantity, 0) })) });
  } catch (error) {
    console.error('Fetch packages error:', error);
    return res.status(500).json({ error: 'Failed to fetch dive packages.' });
  }
});

// POST /api/packages
packagesRouter.post('/', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const parsed = createPackageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: validationIssues(parsed.error)[0].message, details: validationIssues(parsed.error) });
    }

    const { propertyId, name, code, description, items } = parsed.data;

    // Check code uniqueness within property
    const existing = await prisma.divePackage.findUnique({
      where: { propertyId_code: { propertyId, code } },
    });
    if (existing) {
      return res.status(409).json({ error: `Package code '${code}' already exists for this dive centre. Choose a different code.` });
    }

    // Verify all items belong to this property and are active
    const itemIds = items.map(i => i.itemId);
    const foundItems = await prisma.item.findMany({
      where: { id: { in: itemIds }, propertyId, isActive: true },
      select: { id: true, price: true },
    });

    if (foundItems.length !== new Set(itemIds).size) {
      return res.status(400).json({ error: 'One or more selected items do not exist or are not active in this property.' });
    }

    const prices = new Map(foundItems.map(item => [item.id, item.price]));
    const price = items.reduce((sum, row) => sum + prices.get(row.itemId)! * row.quantity, 0);
    if (!Number.isFinite(price)) return res.status(400).json({ error: 'The selected item total is too large.' });

    // Deduplicate item rows by aggregating quantities
    const itemQuantityMap = new Map<string, number>();
    for (const item of items) {
      itemQuantityMap.set(item.itemId, (itemQuantityMap.get(item.itemId) || 0) + item.quantity);
    }

    const divePackage = await prisma.$transaction(async (tx) => {
      const pkg = await tx.divePackage.create({
        data: {
          propertyId,
          code,
          name,
          description: description || null,
          price,
          items: {
            create: Array.from(itemQuantityMap.entries()).map(([itemId, quantity]) => ({
              itemId,
              quantity,
            })),
          },
        },
        include: {
          items: {
            include: {
              item: {
                include: { category: { select: { id: true, name: true } } },
              },
            },
          },
        },
      });
      return pkg;
    });

    await logAuditEvent({
      req,
      propertyId,
      action: 'PACKAGE_CREATE',
      targetType: 'DivePackage',
      targetId: divePackage.id,
      details: { code: divePackage.code, name: divePackage.name, price: divePackage.price, itemsCount: divePackage.items.length },
    });

    return res.status(201).json({ package: divePackage });
  } catch (error) {
    console.error('Create package error:', error);
    return res.status(500).json({ error: 'Failed to create dive package.' });
  }
});

// PUT /api/packages/:id
packagesRouter.put('/:id', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.divePackage.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) return res.status(404).json({ error: 'Dive package not found.' });

    if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) {
      return res.status(403).json({ error: 'Unauthorized to modify packages for this property.' });
    }

    const parsed = updatePackageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: validationIssues(parsed.error)[0].message, details: validationIssues(parsed.error) });
    }

    const { name, description, isActive, items } = parsed.data;

    const selectedItems = items ?? existing.items;
    const itemIds = selectedItems.map(row => row.itemId);
    const foundItems = await prisma.item.findMany({
      where: { id: { in: itemIds }, propertyId: existing.propertyId, ...(items ? { isActive: true } : {}) },
      select: { id: true, price: true },
    });
    if (foundItems.length !== new Set(itemIds).size) {
      return res.status(400).json({ error: 'One or more selected items do not exist or are not active in this property.' });
    }
    const prices = new Map(foundItems.map(item => [item.id, item.price]));
    const price = selectedItems.reduce((sum, row) => sum + prices.get(row.itemId)! * row.quantity, 0);
    if (!Number.isFinite(price)) return res.status(400).json({ error: 'The selected item total is too large.' });

    const updated = await prisma.$transaction(async (tx) => {
      if (items) {
        await tx.divePackageItem.deleteMany({ where: { packageId: id } });
        const itemQuantityMap = new Map<string, number>();
        for (const item of items) {
          itemQuantityMap.set(item.itemId, (itemQuantityMap.get(item.itemId) || 0) + item.quantity);
        }
        await tx.divePackageItem.createMany({
          data: Array.from(itemQuantityMap.entries()).map(([itemId, quantity]) => ({
            packageId: id,
            itemId,
            quantity,
          })),
        });
      }

      return tx.divePackage.update({
        where: { id },
        data: {
          name: name ?? undefined,
          description: description !== undefined ? (description || null) : undefined,
          price,
          isActive: isActive !== undefined ? isActive : undefined,
        },
        include: {
          items: {
            include: {
              item: {
                include: { category: { select: { id: true, name: true } } },
              },
            },
          },
        },
      });
    });

    await logAuditEvent({
      req,
      propertyId: existing.propertyId,
      action: 'PACKAGE_UPDATE',
      targetType: 'DivePackage',
      targetId: updated.id,
      details: { code: updated.code, name: updated.name, price: updated.price, isActive: updated.isActive },
    });

    return res.json({ package: updated });
  } catch (error) {
    console.error('Update package error:', error);
    return res.status(500).json({ error: 'Failed to update dive package.' });
  }
});

// DELETE /api/packages/:id
packagesRouter.delete('/:id', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.divePackage.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Dive package not found.' });

    if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) {
      return res.status(403).json({ error: 'Unauthorized to delete packages for this property.' });
    }

    await prisma.divePackage.delete({ where: { id } });

    await logAuditEvent({
      req,
      propertyId: existing.propertyId,
      action: 'PACKAGE_DELETE',
      targetType: 'DivePackage',
      targetId: id,
      details: { code: existing.code, name: existing.name },
    });

    return res.json({ message: `Package '${existing.name}' deleted successfully.` });
  } catch (error) {
    console.error('Delete package error:', error);
    return res.status(500).json({ error: 'Failed to delete dive package.' });
  }
});
