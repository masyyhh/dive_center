import { boundedArray, validationIssues } from '../utils/validation';
import { pmsPropertyCodeSchema } from '../services/pmsService';
import { randomUUID } from 'node:crypto';
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
  name: z.string().trim().min(2, 'Property name must contain at least 2 characters.'),
  code: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().trim().min(2, 'Property code must contain at least 2 characters (e.g. SUN-BAA, OLHU).').max(10, 'Property code cannot exceed 10 characters.').optional()),
  location: z.string().optional(),
  pmsPropertyCodes: boundedArray(pmsPropertyCodeSchema, 7).refine(codes => new Set(codes).size === codes.length, 'Choose each resort once.').optional(),
  pmsPropertyCode: pmsPropertyCodeSchema.nullish().or(z.literal('')).transform(value => value || null),
  currency: z.string().default('USD'),
  currencySymbol: z.string().default('$'),
  taxRate: z.number().min(0).max(100).default(16.0),
  serviceChargeRate: z.number().min(0).max(100).default(10.0),
  nextCheckNumber: z.number().int().positive().default(1001),
});

const propertyUpdateSchema = propertySchema.omit({ code: true, currency: true, currencySymbol: true, taxRate: true, serviceChargeRate: true, nextCheckNumber: true }).partial().extend({
  code: z.string().trim().min(2, 'Property code must contain at least 2 characters.').max(10, 'Property code cannot exceed 10 characters.').transform(value => value.toUpperCase()).optional(),
  currency: z.string().trim().min(1, 'Currency is required.').optional(),
  currencySymbol: z.string().trim().min(1, 'Currency symbol is required.').optional(),
  taxRate: z.number().min(0).max(100).optional(),
  serviceChargeRate: z.number().min(0).max(100).optional(),
  nextCheckNumber: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

// POST /api/properties (GLOBAL_ADMIN only)
propertiesRouter.post('/', requireAuth, requireRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  try {
    const parseResult = propertySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: validationIssues(parseResult.error)[0].message, details: validationIssues(parseResult.error) });
    }

    const { name, code, pmsPropertyCode, pmsPropertyCodes, location, currency, currencySymbol, taxRate, serviceChargeRate, nextCheckNumber } =
      parseResult.data;

    const baseCode = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 10).replace(/-$/, '');
    let propertyCode = code?.toUpperCase() ?? (baseCode.length >= 2 ? baseCode : 'PROPERTY');
    const existing = code && await prisma.property.findUnique({ where: { code: propertyCode } });
    if (existing) {
      return res.status(409).json({ error: `Property code '${code.toUpperCase()}' is already in use, including retained historical properties. Choose another code.` });
    }

    const createProperty = () => prisma.property.create({
      data: {
        name,
        code: propertyCode,
        pmsPropertyCodes: pmsPropertyCodes ?? (pmsPropertyCode ? [pmsPropertyCode] : []),
        pmsPropertyCode: pmsPropertyCodes ? pmsPropertyCodes[0] ?? null : pmsPropertyCode,
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

    // Retry generated codes on the unique constraint, including concurrent creates
    // and codes reserved by historical properties. Explicit codes stay unchanged.
    let property;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        property = await createProperty();
        break;
      } catch (error) {
        if (code || (error as any)?.code !== 'P2002' || attempt === 4) throw error;
        propertyCode = `${propertyCode.slice(0, 5)}-${randomUUID().slice(0, 4).toUpperCase()}`;
      }
    }
    if (!property) throw new Error('Unable to allocate property code.');

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
      // Ensure manager has access if not global admin
      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(id)) {
        return res.status(403).json({ error: 'Unauthorized to modify this property.' });
      }

      const parsed = propertyUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: validationIssues(parsed.error)[0].message, details: validationIssues(parsed.error) });
      const { pmsPropertyCode, pmsPropertyCodes, code, ...fields } = parsed.data;
      if (req.user!.role !== 'GLOBAL_ADMIN' && (pmsPropertyCode !== undefined || pmsPropertyCodes !== undefined || code !== undefined)) {
        return res.status(403).json({ error: 'Only global administrators can change the property code or PMS resort mapping.' });
      }
      const current = await prisma.property.findUnique({ where: { id }, select: { deletedAt: true } });
      if (!current) return res.status(404).json({ error: 'Property not found.' });
      if (current.deletedAt) return res.status(410).json({ error: 'This property has been removed from the workspace. Its history is retained.' });
      const updated = await prisma.property.update({
        where: { id },
        data: {
          ...fields,
          code,
          ...(pmsPropertyCodes !== undefined
            ? { pmsPropertyCodes, pmsPropertyCode: pmsPropertyCodes[0] ?? null }
            : pmsPropertyCode !== undefined ? { pmsPropertyCode: pmsPropertyCode || null, pmsPropertyCodes: pmsPropertyCode ? [pmsPropertyCode] : [] } : {}),
        },
      });

      await logAuditEvent({
        req,
        propertyId: updated.id,
        action: 'PROPERTY_UPDATE',
        targetType: 'Property',
        targetId: updated.id,
        details: { name: updated.name, code: updated.code, pmsPropertyCodes: updated.pmsPropertyCodes },
      });

      return res.json({ property: updated });
    } catch (error) {
      if ((error as any)?.code === 'P2002') return res.status(409).json({ error: 'This property code is already in use, including retained historical properties. Choose another code.' });
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
