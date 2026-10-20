import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';

export const staffRouter = Router();

// GET /api/staff?propertyId=...&diveStaffOnly=...&activeOnDate=...
staffRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const { propertyId, diveStaffOnly, activeOnDate } = req.query;

    const where: any = {
      propertyId: String(propertyId),
      isActive: true,
    };

    if (diveStaffOnly === 'true') {
      where.isDiveStaff = true;
    }

    let staff = await prisma.staffMember.findMany({
      where,
      orderBy: [{ roleTitle: 'asc' }, { name: 'asc' }],
    });

    if (activeOnDate && typeof activeOnDate === 'string') {
      staff = staff.filter((s) => {
        if (s.hireDate > activeOnDate) return false;
        if (s.leavingDate && s.leavingDate < activeOnDate) return false;
        return true;
      });
    }

    return res.json({ staff });
  } catch (error) {
    console.error('Fetch staff error:', error);
    return res.status(500).json({ error: 'Failed to fetch staff members.' });
  }
});

const staffSchema = z.object({
  propertyId: z.string(),
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal('')),
  roleTitle: z.string().min(2),
  isDiveStaff: z.boolean().default(true),
  isCoursePoolSharing: z.boolean().default(false),
  isDivePoolSharing: z.boolean().default(true),
  isBaseLeaderOverride: z.boolean().default(false),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD'),
  leavingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD').optional().nullable(),
});

// POST /api/staff (GLOBAL_ADMIN or PROPERTY_MANAGER)
staffRouter.post(
  '/',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  requirePropertyAccess('body', 'propertyId'),
  async (req: Request, res: Response) => {
    try {
      const parseResult = staffSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
      }

      const data = parseResult.data;
      const staff = await prisma.staffMember.create({
        data: {
          ...data,
          email: data.email || null,
          leavingDate: data.leavingDate || null,
        },
      });

      await logAuditEvent({
        req,
        propertyId: staff.propertyId,
        action: 'STAFF_CREATE',
        targetType: 'StaffMember',
        targetId: staff.id,
        details: { name: staff.name, role: staff.roleTitle },
      });

      return res.status(201).json({ staff });
    } catch (error) {
      console.error('Create staff error:', error);
      return res.status(500).json({ error: 'Failed to create staff member.' });
    }
  }
);

// PUT /api/staff/:id
staffRouter.put(
  '/:id',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const existing = await prisma.staffMember.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: 'Staff member not found.' });
      }

      // Check property access
      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) {
        return res.status(403).json({ error: 'Unauthorized for this property.' });
      }

      const {
        name,
        email,
        roleTitle,
        isDiveStaff,
        isCoursePoolSharing,
        isDivePoolSharing,
        isBaseLeaderOverride,
        hireDate,
        leavingDate,
        isActive,
      } = req.body;

      const updated = await prisma.staffMember.update({
        where: { id },
        data: {
          name: name ?? undefined,
          email: email !== undefined ? (email ? email : null) : undefined,
          roleTitle: roleTitle ?? undefined,
          isDiveStaff: isDiveStaff !== undefined ? Boolean(isDiveStaff) : undefined,
          isCoursePoolSharing: isCoursePoolSharing !== undefined ? Boolean(isCoursePoolSharing) : undefined,
          isDivePoolSharing: isDivePoolSharing !== undefined ? Boolean(isDivePoolSharing) : undefined,
          isBaseLeaderOverride: isBaseLeaderOverride !== undefined ? Boolean(isBaseLeaderOverride) : undefined,
          hireDate: hireDate ?? undefined,
          leavingDate: leavingDate !== undefined ? (leavingDate ? leavingDate : null) : undefined,
          isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        },
      });

      await logAuditEvent({
        req,
        propertyId: updated.propertyId,
        action: 'STAFF_UPDATE',
        targetType: 'StaffMember',
        targetId: updated.id,
        details: { name: updated.name, roleTitle: updated.roleTitle },
      });

      return res.json({ staff: updated });
    } catch (error) {
      console.error('Update staff error:', error);
      return res.status(500).json({ error: 'Failed to update staff member.' });
    }
  }
);
