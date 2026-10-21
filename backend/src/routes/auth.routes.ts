import { findLoginUser } from '../utils/identity';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { signToken, requireAccountAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/security';
import { logAuditEvent } from '../services/auditService';

export const authRouter = Router();

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1),
});

// POST /api/auth/login
// Implements 5 wrong attempts lock out (PDF Page 2)
authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = loginSchema.safeParse({ ...req.body, identifier: req.body.identifier ?? req.body.username ?? req.body.email });
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Please enter a valid username and password.' });
    }

    const { identifier, password } = parseResult.data;
    const user = await findLoginUser(prisma, identifier, {
      authenticator: { select: { enrolledAt: true } },
      assignedProperties: { include: { property: true } },
    });

    if (!user) {
      await logAuditEvent({ req, action: 'LOGIN_FAILED', targetType: 'User', details: { identifier, reason: 'Unknown account' } });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await logAuditEvent({ req, userId: user.id, action: 'LOGIN_BLOCKED', targetType: 'User', targetId: user.id, details: { reason: 'Account locked' } });
      const minutesRemaining = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / (60 * 1000)));
      return res.status(423).json({
        error: `Account is temporarily locked due to 5 consecutive wrong passwords. Please wait ${minutesRemaining} minute(s) or contact your administrator.`,
      });
    }

    if (!user.isActive) {
      await logAuditEvent({ req, userId: user.id, action: 'LOGIN_BLOCKED', targetType: 'User', targetId: user.id, details: { reason: 'Account deactivated' } });
      return res.status(403).json({ error: 'Your account is deactivated. Please contact your administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      const newAttempts = user.failedLoginAttempts + 1;
      let lockedUntil: Date | null = null;
      let lockMessage = 'Invalid username or password.';

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

    if (user.mustChangePassword) {
      await logAuditEvent({ req, userId: user.id, action: 'LOGIN_PASSWORD_CHANGE_REQUIRED', targetType: 'User', targetId: user.id });
      return res.json({ passwordChangeRequired: true, changeToken: signToken({
        id: user.id, email: user.email, role: user.role, passwordHash: user.passwordHash, purpose: 'password-change',
      }) });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      passwordHash: user.passwordHash,
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
        .filter((p: any) => p.property.isActive)
        .map((p: any) => p.property);
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
        username: user.username,
        authenticatorEnabled: Boolean(user.authenticator?.enrolledAt),
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
authRouter.get('/me', requireAccountAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        authenticator: { select: { enrolledAt: true } },
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
        .filter((p: any) => p.property.isActive)
        .map((p: any) => p.property);
    }

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        authenticatorEnabled: Boolean(user.authenticator?.enrolledAt),
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

// The client calls this before removing its local token.
authRouter.post('/logout', requireAccountAuth, async (req: Request, res: Response) => {
  await logAuditEvent({ req, action: 'LOGOUT', targetType: 'User', targetId: req.user!.id });
  return res.json({ message: 'Signed out.' });
});
