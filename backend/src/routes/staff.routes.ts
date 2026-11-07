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
import { defaultStaffRoleTitles, normalizeRoleTitle, uniqueRoleTitles } from '../utils/staffRoleTitles';

export const staffRouter = Router();

const roleTitleSchema = z.string().transform(normalizeRoleTitle).pipe(z.string().min(2).max(100));
const createRoleTitleSchema = z.object({ propertyId: z.string().min(1), name: roleTitleSchema });

async function listRoleTitles(propertyId: string) {
  const [saved, existing] = await Promise.all([
    prisma.staffRoleTitle.findMany({ where: { propertyId }, orderBy: { name: 'asc' } }),
    prisma.staffMember.findMany({ where: { propertyId }, select: { roleTitle: true }, distinct: ['roleTitle'] }),
  ]);
  return uniqueRoleTitles([...defaultStaffRoleTitles, ...saved.map(title => title.name), ...existing.map(staff => staff.roleTitle)]);
}

staffRouter.get('/role-titles', requireAuth, requirePropertyAccess('query'), async (req: Request, res: Response) => {
  const propertyId = req.query.propertyId;
  if (typeof propertyId !== 'string' || !propertyId) return res.status(400).json({ error: 'Property ID is required.' });
  try {
    return res.json({ roleTitles: await listRoleTitles(propertyId) });
  } catch (error) {
    console.error('Fetch role titles error:', error);
    return res.status(500).json({ error: 'Failed to fetch role titles.' });
  }
});

staffRouter.post('/role-titles', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body'), async (req: Request, res: Response) => {
  const parsed = createRoleTitleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a role title between 2 and 100 characters and select a property.' });
  const { propertyId, name } = parsed.data;
  try {
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property?.isActive || property.deletedAt) return res.status(400).json({ error: 'Select an active property.' });
    const normalizedName = name.toLowerCase();
    if ((await listRoleTitles(propertyId)).some(title => title.toLowerCase() === normalizedName)) {
      return res.status(409).json({ error: 'This role title already exists for this property.' });
    }
    const title = await prisma.staffRoleTitle.create({ data: { propertyId, name, normalizedName } });
    await logAuditEvent({ req, propertyId, action: 'STAFF_ROLE_TITLE_CREATE', targetType: 'StaffRoleTitle', targetId: title.id, details: { name } });
    return res.status(201).json({ roleTitle: title.name });
  } catch (error) {
    if ((error as any)?.code === 'P2002') return res.status(409).json({ error: 'This role title already exists for this property.' });
    console.error('Create role title error:', error);
    return res.status(500).json({ error: 'Failed to create role title.' });
  }
});

// GET /api/staff?propertyId=...&diveStaffOnly=...&activeOnDate=...
staffRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const { propertyId, diveStaffOnly, activeOnDate, creditOnDate, includeInactive } = req.query;
    if (typeof propertyId !== 'string' || !propertyId.trim()) return res.status(400).json({ error: 'Property ID is required.' });
    if (diveStaffOnly !== undefined && diveStaffOnly !== 'true' && diveStaffOnly !== 'false') return res.status(400).json({ error: 'Choose true or false for diveStaffOnly.' });
    if (activeOnDate !== undefined && !isBusinessDate(activeOnDate)) return res.status(400).json({ error: 'Enter a valid activeOnDate (YYYY-MM-DD).' });

    if (creditOnDate !== undefined && !isBusinessDate(creditOnDate)) {
      return res.status(400).json({ error: 'Valid creditOnDate (YYYY-MM-DD) is required.' });
    }

    if (includeInactive !== undefined && includeInactive !== 'true' && includeInactive !== 'false') return res.status(400).json({ error: 'Choose true or false for includeInactive.' });
    if (includeInactive === 'true' && !['GLOBAL_ADMIN', 'PROPERTY_MANAGER'].includes(req.user!.role)) return res.status(403).json({ error: 'Only property managers and administrators can manage inactive staff.' });
    if (includeInactive === 'true' && (activeOnDate !== undefined || creditOnDate !== undefined)) return res.status(400).json({ error: 'Inactive staff are available only in the staff roster.' });
    const where: any = {
      propertyId: String(propertyId),
      ...(includeInactive === 'true' ? {} : { isActive: true }),
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
  name: z.string().trim().min(2).max(200),
  email: z.string().email().optional().or(z.literal('')),
  erNumber: z.string().trim().max(100).nullish().transform(value => value === '' ? null : value),
  roleTitle: roleTitleSchema,
  isDiveStaff: z.boolean().default(true),
  isCoursePoolSharing: z.boolean().default(false),
  isDivePoolSharing: z.boolean().default(true),
  isBaseLeaderOverride: z.boolean().default(false),
  hireDate: z.string().refine(isBusinessDate, 'Enter a valid hire date.'),
  leavingDate: z.preprocess(value => value === '' ? null : value, z.string().refine(isBusinessDate, 'Enter a valid leaving date.').nullish()),
  loginAccess: z.object({ username: usernameSchema, password: passwordSchema }).optional(),
});

const staffUpdateSchema = staffSchema.omit({ propertyId: true, loginAccess: true }).partial()
  .extend({
    isActive: z.boolean().optional(), email: staffSchema.shape.email.nullable(),
    isDiveStaff: z.boolean().optional(), isCoursePoolSharing: z.boolean().optional(),
    isDivePoolSharing: z.boolean().optional(), isBaseLeaderOverride: z.boolean().optional(),
  }).strict()
  .refine(data => Object.keys(data).length > 0, 'Choose a staff field to update.');

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

      const parsed = staffUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Check the staff details.', details: validationIssues(parsed.error) });
      const data = parsed.data;
      const hireDate = data.hireDate ?? existing.hireDate;
      const leavingDate = data.leavingDate === undefined ? existing.leavingDate : data.leavingDate;
      if (leavingDate && leavingDate < hireDate) return res.status(400).json({ error: 'Leaving date cannot be before the hire date.' });

      const updated = await prisma.staffMember.update({
        where: { id },
        data: {
          ...data,
          email: data.email === '' ? null : data.email,
        },
      });

      await logAuditEvent({
        req,
        propertyId: updated.propertyId,
        action: 'STAFF_UPDATE',
        targetType: 'StaffMember',
        targetId: updated.id,
        details: { name: updated.name, roleTitle: updated.roleTitle, before: Object.fromEntries(Object.keys(data).map(key => [key, existing[key as keyof typeof existing]])), after: Object.fromEntries(Object.keys(data).map(key => [key, updated[key as keyof typeof updated]])) },
      });

      return res.json({ staff: updated });
    } catch (error) {
      console.error('Update staff error:', error);
      return res.status(500).json({ error: 'Failed to update staff member.' });
    }
  }
);
