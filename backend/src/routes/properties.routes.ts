import { pmsPropertyCodeSchema } from '../services/pmsService';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';

export const propertiesRouter = Router();

// GET /api/properties
// Centre Staff: returns only their assigned centre.
// Property Manager: returns their assigned centres.
// Global Admin: returns all properties.
propertiesRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userRole = req.user!.role;
    let properties: any[] = [];

    if (userRole === 'GLOBAL_ADMIN') {
      properties = await prisma.property.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              bills: true,
              staffMembers: true,
            },
          },
        },
      });
    } else {
      properties = await prisma.property.findMany({
        where: {
          id: { in: req.user!.assignedPropertyIds },
          isActive: true,
          deletedAt: null,
        },
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              bills: true,
              staffMembers: true,
            },
          },
        },
      });
    }

    return res.json({ properties });
  } catch (error) {
    console.error('Fetch properties error:', error);
    return res.status(500).json({ error: 'Failed to fetch properties.' });
  }
});

const propertySchema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().min(2).max(10),
  location: z.string().optional(),
  pmsPropertyCode: pmsPropertyCodeSchema.nullish().or(z.literal('')).transform(value => value || null),
  currency: z.string().default('USD'),
  currencySymbol: z.string().default('$'),
  taxRate: z.number().min(0).max(100).default(16.0),
  serviceChargeRate: z.number().min(0).max(100).default(10.0),
  nextCheckNumber: z.number().int().positive().default(1001),
});

// POST /api/properties (GLOBAL_ADMIN only)
propertiesRouter.post('/', requireAuth, requireRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  try {
    const parseResult = propertySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
    }

    const { name, code, pmsPropertyCode, location, currency, currencySymbol, taxRate, serviceChargeRate, nextCheckNumber } =
      parseResult.data;

    const existing = await prisma.property.findUnique({ where: { code: code.toUpperCase() } });
    if (existing) {
      return res.status(409).json({ error: `Property code '${code.toUpperCase()}' is already in use, including retained historical properties. Choose another code.` });
    }

    const property = await prisma.property.create({
      data: {
        name,
        code: code.toUpperCase(),
        pmsPropertyCode,
        location,
        currency,
        currencySymbol,
        taxRate,
        serviceChargeRate,
        nextCheckNumber,
        categories: {
          create: [
            { name: 'Dives', sortOrder: 1 },
            { name: 'Courses', sortOrder: 2 },
            { name: 'Photo & Video', sortOrder: 3 },
            { name: 'Rentals', sortOrder: 4 },
            { name: 'Retail', sortOrder: 5 },
          ],
        },
      },
    });

    await logAuditEvent({
      req,
      propertyId: property.id,
      action: 'PROPERTY_CREATE',
      targetType: 'Property',
      targetId: property.id,
      details: { name: property.name, code: property.code },
    });

    return res.status(201).json({ property });
  } catch (error) {
    if ((error as any)?.code === 'P2002') return res.status(409).json({ error: 'This property code is already in use. Choose another code.' });
    console.error('Create property error.');
    return res.status(500).json({ error: 'Failed to create property.' });
  }
});

// PUT /api/properties/:id (GLOBAL_ADMIN or PROPERTY_MANAGER)
propertiesRouter.put(
  '/:id',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { name, location, currency, currencySymbol, taxRate, serviceChargeRate, nextCheckNumber, isActive } =
        req.body;

      // Ensure manager has access if not global admin
      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(id)) {
        return res.status(403).json({ error: 'Unauthorized to modify this property.' });
      }

      const pmsCode = z.object({ pmsPropertyCode: pmsPropertyCodeSchema.nullable().or(z.literal('')).optional() }).safeParse(req.body);
      if (!pmsCode.success) return res.status(400).json({ error: 'Select a valid PMS resort code.' });
      if (req.user!.role !== 'GLOBAL_ADMIN' && pmsCode.data.pmsPropertyCode !== undefined) {
        return res.status(403).json({ error: 'Only global administrators can change the PMS resort mapping.' });
      }
      const current = await prisma.property.findUnique({ where: { id }, select: { deletedAt: true } });
      if (!current) return res.status(404).json({ error: 'Property not found.' });
      if (current.deletedAt) return res.status(410).json({ error: 'This property has been removed from the workspace. Its history is retained.' });
      const updated = await prisma.property.update({
        where: { id },
        data: {
          pmsPropertyCode: pmsCode.data.pmsPropertyCode === '' ? null : pmsCode.data.pmsPropertyCode,
          name: name ?? undefined,
          location: location ?? undefined,
          currency: currency ?? undefined,
          currencySymbol: currencySymbol ?? undefined,
          taxRate: taxRate !== undefined ? Number(taxRate) : undefined,
          serviceChargeRate: serviceChargeRate !== undefined ? Number(serviceChargeRate) : undefined,
          nextCheckNumber: nextCheckNumber !== undefined ? Number(nextCheckNumber) : undefined,
          isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        },
      });

      await logAuditEvent({
        req,
        propertyId: updated.id,
        action: 'PROPERTY_UPDATE',
        targetType: 'Property',
        targetId: updated.id,
        details: { name: updated.name },
      });

      return res.json({ property: updated });
    } catch (error) {
      console.error('Update property error:', error);
      return res.status(500).json({ error: 'Failed to update property.' });
    }
  }
);

// DELETE archives the property and revokes its login assignments while retaining business history.
propertiesRouter.delete('/:id', requireAuth, requireRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  const parsed = z.object({ confirmationCode: z.string().trim().min(1).max(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the property code to confirm deletion.' });
  const id = String(req.params.id);
  try {
    const result = await prisma.$transaction(async tx => {
      const property = await tx.property.findUnique({ where: { id } });
      if (!property || property.deletedAt) return 'missing';
      if (parsed.data.confirmationCode.toUpperCase() !== property.code) return 'confirmation';
      const changed = await tx.property.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } });
      if (!changed.count) return 'missing';
      const assignments = await tx.userProperty.deleteMany({ where: { propertyId: id } });
      await tx.auditLog.create({ data: {
        propertyId: id, userId: req.user!.id, action: 'PROPERTY_DELETE', targetType: 'Property', targetId: id,
        details: JSON.stringify({ name: property.name, code: property.code, historyRetained: true, removedAssignments: assignments.count }),
        ipAddress: req.ip || req.socket?.remoteAddress || null,
      } });
      return 'deleted';
    });
    if (result === 'missing') return res.status(404).json({ error: 'Property not found or already removed.' });
    if (result === 'confirmation') return res.status(400).json({ error: 'The confirmation code does not match this property.' });
    return res.json({ message: 'Property removed from the workspace. Bills, staff records, payroll and audit history have been retained.' });
  } catch {
    console.error('Property deletion failed.');
    return res.status(500).json({ error: 'Unable to delete this property. Please try again.' });
  }
});
