import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { signToken, requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/security';
import { logAuditEvent } from '../services/auditService';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/login
// Implements 5 wrong attempts lock out (PDF Page 2)
authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Please enter a valid email and password.' });
    }

    const { email, password } = parseResult.data;
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        assignedProperties: {
          include: { property: true },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesRemaining = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / (60 * 1000)));
      return res.status(423).json({
        error: `Account is temporarily locked due to 5 consecutive wrong passwords. Please wait ${minutesRemaining} minute(s) or contact your administrator.`,
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Your account is deactivated. Please contact your administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      const newAttempts = user.failedLoginAttempts + 1;
      let lockedUntil: Date | null = null;
      let lockMessage = 'Invalid email or password.';

      if (newAttempts >= 5) {
        // Lock for 15 minutes
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        lockMessage = 'Account temporarily locked for 15 minutes due to 5 wrong passwords in a row.';

        await logAuditEvent({
          req,
          userId: user.id,
          action: 'ACCOUNT_LOCKED',
          targetType: 'User',
          targetId: user.id,
          details: { email: user.email, reason: '5 wrong password attempts' },
        });
      } else {
        await logAuditEvent({
          req,
          userId: user.id,
          action: 'LOGIN_FAILED',
          targetType: 'User',
          targetId: user.id,
          details: { email: user.email, attempt: newAttempts },
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newAttempts,
          lockedUntil,
        },
      });

      return res.status(401).json({
        error: lockMessage,
        attemptsRemaining: Math.max(0, 5 - newAttempts),
      });
    }

    // Reset failed login attempts on successful sign-in
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // If Global Admin, list all properties, else list assigned properties
    let properties: any[] = [];
    if (user.role === 'GLOBAL_ADMIN') {
      properties = await prisma.property.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    } else {
      properties = user.assignedProperties
        .filter((p) => p.property.isActive)
        .map((p) => p.property);
    }

    await logAuditEvent({
      req,
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      targetType: 'User',
      targetId: user.id,
      details: { email: user.email, role: user.role },
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        assignedProperties: properties,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error during sign in.' });
  }
});

// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        assignedProperties: {
          include: { property: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let properties: any[] = [];
    if (user.role === 'GLOBAL_ADMIN') {
      properties = await prisma.property.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    } else {
      properties = user.assignedProperties
        .filter((p) => p.property.isActive)
        .map((p) => p.property);
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        assignedProperties: properties,
      },
    });
  } catch (error) {
    console.error('Auth /me error:', error);
    return res.status(500).json({ error: 'Failed to fetch current user profile.' });
  }
});
