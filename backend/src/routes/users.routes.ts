import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';

export const usersRouter = Router();

// All user management routes require GLOBAL_ADMIN
usersRouter.use(requireAuth, requireRole('GLOBAL_ADMIN'));

// GET /api/users
usersRouter.get('/', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        isActive: true,
        createdAt: true,
        assignedProperties: {
          include: {
            property: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    return res.json({ users });
  } catch (error) {
    console.error('Fetch users error:', error);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  role: z.enum(['GLOBAL_ADMIN', 'PROPERTY_MANAGER', 'CENTRE_STAFF']),
  propertyIds: z.array(z.string()).optional(),
});

// POST /api/users
usersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
    }

    const { email, name, password, role, propertyIds } = parseResult.data;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return res.status(400).json({ error: `User with email '${email}' already exists.` });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        role,
        assignedProperties: {
          create: (propertyIds || []).map((propertyId) => ({ propertyId })),
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
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
    console.error('Create user error:', error);
    return res.status(500).json({ error: 'Failed to create user.' });
  }
});

// PUT /api/users/:id
usersRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, role, propertyIds, isActive } = req.body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found.' });
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
// Admin sets new password (PDF Page 2: "Passwords are set by your administrator")
usersRouter.post('/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'PASSWORD_RESET',
      targetType: 'User',
      targetId: id,
      details: { message: 'Password reset by administrator' },
    });

    return res.json({ message: 'Password updated successfully. Account lock has been cleared.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// POST /api/users/:id/unlock
// Admin manually unlocks a locked account
usersRouter.post('/:id/unlock', async (req: Request, res: Response) => {
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
