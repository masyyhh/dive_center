import { boundedArray, validationIssues } from '../utils/validation';
import { withSerializableTransaction } from '../utils/transactions';
import { usernameSchema } from '../utils/identity';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';

import { passwordSchema, passwordPolicyMessage } from '../utils/password';

export const usersRouter = Router();

// Managers may list and reset their staff accounts; other account management stays global-only.
usersRouter.use(requireAuth);
const accountManagers = requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER');

// GET /api/users
usersRouter.get('/', accountManagers, async (req: Request, res: Response) => {
  try {
    const managerPropertyIds = req.user!.assignedPropertyIds;
    const users = await prisma.user.findMany({
      // All assignments must be managed by the caller because a password controls the whole account.
      where: req.user!.role === 'GLOBAL_ADMIN' ? { deletedAt: null } : {
        deletedAt: null,
        role: 'CENTRE_STAFF',
        assignedProperties: {
          some: { propertyId: { in: managerPropertyIds } },
          every: { propertyId: { in: managerPropertyIds } },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        isActive: true,
        createdAt: true,
        authenticator: { select: { enrolledAt: true } },
        assignedProperties: {
          include: {
            property: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    return res.json({ users: users.map(({ authenticator, ...user }) => ({ ...user, authenticatorEnabled: Boolean(authenticator?.enrolledAt), assignedProperties: user.assignedProperties.map(assignment => assignment.property) })) });
  } catch (error) {
    console.error('Fetch users error:', error);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

const createUserSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().email().optional().or(z.literal('')).transform(value => value?.toLowerCase() || null),
  name: z.string().min(2),
  password: passwordSchema,
  role: z.enum(['GLOBAL_ADMIN', 'PROPERTY_MANAGER', 'CENTRE_STAFF']),
  propertyIds: boundedArray(z.string(), 1000).optional(),
});

// POST /api/users
usersRouter.post('/', accountManagers, async (req: Request, res: Response) => {
  try {
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: validationIssues(parseResult.error)[0].message, details: validationIssues(parseResult.error) });
    }

    const { username, email, name, password, role, propertyIds } = parseResult.data;

    if (req.user!.role === 'PROPERTY_MANAGER' && (role !== 'CENTRE_STAFF' || !propertyIds?.length || propertyIds.some(id => !req.user!.assignedPropertyIds.includes(id)))) {
      return res.status(403).json({ error: 'You can only create centre staff assigned to properties you manage.' });
    }
    const assignments = [...new Set(propertyIds || [])];
    if (assignments.length && await prisma.property.count({ where: { id: { in: assignments }, isActive: true } }) !== assignments.length) {
      return res.status(400).json({ error: 'Select valid, active properties.' });
    }
    const existing = await prisma.user.findFirst({ where: { OR: [{ username }, { email: username }] } });
    if (existing) {
      return res.status(400).json({ error: 'This username is already in use.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        name,
        passwordHash,
        mustChangePassword: true,
        role,
        assignedProperties: {
          create: assignments.map((propertyId) => ({ propertyId })),
        },
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        authenticator: { select: { enrolledAt: true } },
        assignedProperties: {
          include: { property: true },
        },
      },
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'USER_CREATE',
      targetType: 'User',
      targetId: user.id,
      details: { email: user.email, role: user.role },
    });

    return res.status(201).json({ user });
  } catch (error) {
    if ((error as any)?.code === 'P2002') return res.status(409).json({ error: 'This username is already in use.' });
    console.error('Create user error.');
    return res.status(500).json({ error: 'Failed to create user.' });
  }
});

const updateUserSchema = createUserSchema.omit({ password: true }).partial().extend({
  name: z.string().trim().min(2, 'Name must contain at least 2 characters.').optional(),
  isActive: z.boolean().optional(),
  propertyIds: boundedArray(z.string().min(1), 1000).refine(ids => new Set(ids).size === ids.length, 'Choose each property once.').optional(),
}).strict().refine(data => Object.keys(data).length > 0, 'Provide account details to update.');

// PUT /api/users/:id
usersRouter.put('/:id', requireRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: validationIssues(parsed.error)[0].message });
  const id = String(req.params.id);
  const { propertyIds, ...fields } = parsed.data;
  if (id === req.user!.id && (fields.isActive === false || (fields.role !== undefined && fields.role !== 'GLOBAL_ADMIN'))) {
    return res.status(400).json({ error: 'You cannot disable or demote your own administrator account.' });
  }
  try {
    const result = await withSerializableTransaction(prisma, async tx => {
      const actor = await tx.user.findUnique({ where: { id: req.user!.id } });
      if (!actor?.isActive || actor.deletedAt || actor.role !== 'GLOBAL_ADMIN') return { status: 403, error: 'Global administrator access required.' };
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) return { status: 404, error: 'User not found.' };
      if (propertyIds && await tx.property.count({ where: { id: { in: propertyIds }, deletedAt: null, OR: [{ isActive: true }, { users: { some: { userId: id } } }] } }) !== propertyIds.length) {
        return { status: 400, error: 'New assignments must use valid, active properties.' };
      }
      if (fields.username && await tx.user.findFirst({ where: { id: { not: id }, OR: [{ username: fields.username }, { email: fields.username }] } })) {
        return { status: 409, error: 'This username is already in use.' };
      }
      const updated = await tx.user.update({
        where: { id },
        data: { ...fields, ...(propertyIds !== undefined ? { assignedProperties: { deleteMany: {}, create: propertyIds.map(propertyId => ({ propertyId })) } } : {}) },
        select: { id: true, username: true, email: true, name: true, role: true, isActive: true, assignedProperties: { include: { property: true } } },
      });
      await tx.auditLog.create({ data: {
        userId: req.user!.id, action: 'USER_UPDATE', targetType: 'User', targetId: id,
        details: JSON.stringify({ updatedFields: parsed.data }), ipAddress: req.ip || null,
      } });
      return { user: { ...updated, assignedProperties: updated.assignedProperties.map(assignment => assignment.property) } };
    });
    if (result.status !== undefined) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  } catch (error) {
    if ((error as any)?.code === 'P2002') return res.status(409).json({ error: 'This username is already in use.' });
    console.error('Update user failed.');
    return res.status(500).json({ error: 'Failed to update user.' });
  }
});

// Retain account references for bills, payroll and audit history while revoking access.
usersRouter.delete('/:id', requireRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  const parsed = z.object({ confirmationUsername: usernameSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the username to confirm deletion.' });
  const id = String(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ error: 'You cannot delete your own administrator account.' });
  try {
    const result = await withSerializableTransaction(prisma, async tx => {
      const actor = await tx.user.findUnique({ where: { id: req.user!.id } });
      if (!actor?.isActive || actor.deletedAt || actor.role !== 'GLOBAL_ADMIN') return { status: 403, error: 'Global administrator access required.' };
      const target = await tx.user.findUnique({ where: { id } });
      if (!target || target.deletedAt) return { status: 404, error: 'User not found or already deleted.' };
      if (target.username !== parsed.data.confirmationUsername) return { status: 400, error: 'The username does not match this account.' };
      await tx.user.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
      await tx.userProperty.deleteMany({ where: { userId: id } });
      await tx.authenticator.deleteMany({ where: { userId: id } });
      await tx.passwordReset.deleteMany({ where: { userId: id } });
      await tx.auditLog.create({ data: {
        userId: req.user!.id, action: 'USER_DELETE', targetType: 'User', targetId: id,
        details: JSON.stringify({ username: target.username, name: target.name, historyRetained: true }), ipAddress: req.ip || null,
      } });
      return { message: 'User deleted. Access revoked; billing, payroll and audit history retained.' };
    });
    if (result.status !== undefined) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  } catch {
    console.error('Delete user failed.');
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// POST /api/users/:id/reset-password
// Global administrators and the staff account's property manager can set a new password.
usersRouter.post('/:id/reset-password', accountManagers, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { password, resetAuthenticator } = req.body;
    if (resetAuthenticator !== undefined && typeof resetAuthenticator !== 'boolean') return res.status(400).json({ error: 'Invalid authenticator reset option.' });

    if (!passwordSchema.safeParse(password).success) {
      return res.status(400).json({ error: passwordPolicyMessage });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await withSerializableTransaction(prisma, async tx => {
      const actor = await tx.user.findUnique({ where: { id: req.user!.id }, include: { assignedProperties: { include: { property: true } } } });
      if (!actor?.isActive || actor.deletedAt || actor.mustChangePassword || actor.passwordHash !== req.authenticatedPasswordHash || (actor.lockedUntil && actor.lockedUntil > new Date()) || !['GLOBAL_ADMIN', 'PROPERTY_MANAGER'].includes(actor.role) || (req.authenticatedTokenHash && await tx.revokedToken.findUnique({ where: { tokenHash: req.authenticatedTokenHash } }))) {
        return { status: 403, error: 'Account management access is no longer available.' };
      }
      const target = await tx.user.findUnique({ where: { id }, include: { assignedProperties: true } });
      if (!target || target.deletedAt) return { status: 404, error: 'User not found.' };
      const managed = new Set(actor.assignedProperties.filter(assignment => !assignment.property.deletedAt).map(assignment => assignment.propertyId));
      if (actor.role === 'PROPERTY_MANAGER' && (target.role !== 'CENTRE_STAFF' || !target.assignedProperties.length || !target.assignedProperties.every(assignment => managed.has(assignment.propertyId)))) {
        return { status: 403, error: 'You can only reset passwords for staff whose properties you manage.' };
      }
      await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null } });
      if (resetAuthenticator) {
        await tx.authenticator.deleteMany({ where: { userId: id } });
        await tx.passwordReset.deleteMany({ where: { userId: id } });
      }
      await tx.auditLog.create({ data: {
        userId: actor.id, action: 'PASSWORD_RESET', targetType: 'User', targetId: id,
        propertyId: target.assignedProperties[0]?.propertyId ?? null,
        details: JSON.stringify({ message: 'Password reset by account manager', actorRole: actor.role, authenticatorCleared: Boolean(resetAuthenticator) }),
        ipAddress: req.ip || null,
      } });
      return { status: 200 };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });

    return res.json({ message: 'Password updated successfully. Account lock has been cleared.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// POST /api/users/:id/unlock
// Admin manually unlocks a locked account
usersRouter.post('/:id/unlock', requireRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const target = await prisma.user.findUnique({ where: { id }, select: { deletedAt: true } });
    if (!target || target.deletedAt) return res.status(404).json({ error: 'User not found.' });
    await prisma.user.update({
      where: { id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'ACCOUNT_UNLOCKED',
      targetType: 'User',
      targetId: id,
      details: { message: 'Account manually unlocked by administrator' },
    });

    return res.json({ message: 'Account unlocked successfully.' });
  } catch (error) {
    console.error('Unlock user error:', error);
    return res.status(500).json({ error: 'Failed to unlock account.' });
  }
});
