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
      where: req.user!.role === 'GLOBAL_ADMIN' ? {} : {
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
  propertyIds: z.array(z.string()).optional(),
});

// POST /api/users
usersRouter.post('/', accountManagers, async (req: Request, res: Response) => {
  try {
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message, details: parseResult.error.errors });
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

// PUT /api/users/:id
usersRouter.put('/:id', requireRole('GLOBAL_ADMIN'), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, role, propertyIds, isActive } = req.body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (Array.isArray(propertyIds)) {
      if (propertyIds.some(id => typeof id !== 'string') || new Set(propertyIds).size !== propertyIds.length || await prisma.property.count({ where: { id: { in: propertyIds }, isActive: true, deletedAt: null } }) !== propertyIds.length) {
        return res.status(400).json({ error: 'Assign only valid, active properties.' });
      }
    }

    // Update basic fields
    await prisma.user.update({
      where: { id },
      data: {
        name: name ?? undefined,
        role: role ?? undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
      },
    });

    // If propertyIds provided, update relations
    if (Array.isArray(propertyIds)) {
      await prisma.userProperty.deleteMany({ where: { userId: id } });
      await prisma.userProperty.createMany({
        data: propertyIds.map((propertyId: string) => ({ userId: id, propertyId })),
      });
    }

    const updated = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        assignedProperties: {
          include: { property: true },
        },
      },
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'USER_UPDATE',
      targetType: 'User',
      targetId: id,
      details: { updatedFields: { name, role, isActive, propertyIds } },
    });

    return res.json({ user: updated });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ error: 'Failed to update user.' });
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

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, assignedProperties: { select: { propertyId: true } } },
    });
    if (!target) return res.status(404).json({ error: 'User not found.' });

    if (req.user!.role === 'PROPERTY_MANAGER') {
      const canReset = target.role === 'CENTRE_STAFF' && target.assignedProperties.length > 0 &&
        target.assignedProperties.every(assignment => req.user!.assignedPropertyIds.includes(assignment.propertyId));
      if (!canReset) {
        return res.status(403).json({ error: 'You can only reset passwords for staff whose properties you manage.' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const update = { where: { id }, data: { passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null } };
    if (resetAuthenticator) {
      await prisma.$transaction(async tx => {
        await tx.user.update(update);
        await tx.authenticator.deleteMany({ where: { userId: id } });
        await tx.passwordReset.deleteMany({ where: { userId: id } });
      });
    } else {
      await prisma.user.update(update);
    }

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'PASSWORD_RESET',
      targetType: 'User',
      targetId: id,
      propertyId: target.assignedProperties[0]?.propertyId,
      details: { message: 'Password reset by account manager', actorRole: req.user!.role, authenticatorCleared: Boolean(resetAuthenticator) },
    });

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
