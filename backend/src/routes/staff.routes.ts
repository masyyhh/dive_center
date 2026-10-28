import { validationIssues } from '../utils/validation';
import bcrypt from 'bcryptjs';
import { usernameSchema } from '../utils/identity';
import { passwordSchema } from '../utils/password';
import { isBusinessDate } from '../utils/dates';
import { isExcludedFromCredit } from '../utils/staffEligibility';
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
    const { propertyId, diveStaffOnly, activeOnDate, creditOnDate } = req.query;

    if (creditOnDate !== undefined && !isBusinessDate(creditOnDate)) {
      return res.status(400).json({ error: 'Valid creditOnDate (YYYY-MM-DD) is required.' });
    }

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

    if (typeof creditOnDate === 'string') {
      const attendance = await prisma.attendance.findMany({ where: { propertyId: String(propertyId), date: creditOnDate } });
      const excluded = new Set(attendance.filter(a => isExcludedFromCredit(a.status)).map(a => a.staffMemberId));
      staff = staff.filter(s => s.hireDate <= creditOnDate && (!s.leavingDate || s.leavingDate >= creditOnDate) && !excluded.has(s.id));
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
  hireDate: z.string().refine(isBusinessDate, 'Enter a valid hire date.'),
  leavingDate: z.preprocess(value => value === '' ? null : value, z.string().refine(isBusinessDate, 'Enter a valid leaving date.').nullish()),
  loginAccess: z.object({ username: usernameSchema, password: passwordSchema }).optional(),
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
        return res.status(400).json({ error: 'Validation failed', details: validationIssues(parseResult.error) });
      }

      const { loginAccess, ...data } = parseResult.data;
      if (data.leavingDate && data.leavingDate < data.hireDate) return res.status(400).json({ error: 'Leaving date cannot be before the hire date.' });
      const property = await prisma.property.findUnique({ where: { id: data.propertyId } });
      if (!property?.isActive || property.deletedAt) return res.status(400).json({ error: 'Select an active property.' });
      if (loginAccess && await prisma.user.findFirst({ where: { OR: [{ username: loginAccess.username }, { email: loginAccess.username }] } })) return res.status(409).json({ error: 'This username is already in use.' });
      const passwordHash = loginAccess ? await bcrypt.hash(loginAccess.password, 12) : undefined;
      const { propertyId, ...staffFields } = data;
      const staff = await prisma.staffMember.create({
        data: {
          ...staffFields,
          property: { connect: { id: propertyId } },
          ...(loginAccess ? { user: { create: {
            username: loginAccess.username, passwordHash: passwordHash!, name: data.name, email: data.email || null,
            role: 'CENTRE_STAFF', mustChangePassword: true,
            assignedProperties: { create: { propertyId: data.propertyId } },
          } } } : {}),
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
        details: { name: staff.name, role: staff.roleTitle, loginAccess: Boolean(loginAccess) },
      });

      if (staff.userId) await logAuditEvent({ req, propertyId: staff.propertyId, action: 'USER_CREATE', targetType: 'User', targetId: staff.userId, details: { role: 'CENTRE_STAFF', source: 'staff-create' } });
      return res.status(201).json({ staff });
    } catch (error) {
      if ((error as any)?.code === 'P2002') return res.status(409).json({ error: 'This username is already in use.' });
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
      const existing = await prisma.staffMember.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
      if (!existing) {
        return res.status(404).json({ error: 'Staff member not found.' });
      }

      // Check property access
      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) {
        return res.status(403).json({ error: 'Unauthorized for this property.' });
      }

      if (existing.property?.deletedAt) return res.status(410).json({ error: 'This property has been removed. Its records are read-only.' });

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
