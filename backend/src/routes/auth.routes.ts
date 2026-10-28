import { findLoginUser } from '../utils/identity';
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { signToken, requireAccountAuth, requireLogoutAuth } from '../middleware/auth';
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
    // Lock the account before comparing a password: the sixth concurrent request
    // must observe the committed lock instead of evaluating another guess.
    const result = await prisma.$transaction(async tx => {
      const candidate = await findLoginUser(tx, identifier);
      if (!candidate) return { kind: 'unknown' as const };
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const user = await findLoginUser(tx, identifier, {
        authenticator: { select: { enrolledAt: true } },
        assignedProperties: { include: { property: true } },
      });
      if (!user || user.id !== candidate.id) return { kind: 'unknown' as const };
      if (user.lockedUntil && user.lockedUntil > new Date()) return { kind: 'locked' as const, user };
      if (!user.isActive || user.deletedAt) return { kind: 'inactive' as const, user };
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        const attempts = user.lockedUntil ? 1 : user.failedLoginAttempts + 1;
        const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null;
        await tx.user.update({ where: { id: user.id }, data: { failedLoginAttempts: attempts, lockedUntil } });
        return { kind: 'invalid' as const, user, attempts };
      }
      await tx.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
      return { kind: 'authenticated' as const, user };
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 });

    if (result.kind === 'unknown') {
      await logAuditEvent({ req, action: 'LOGIN_FAILED', targetType: 'User', details: { identifier, reason: 'Unknown account' } });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const { user } = result;
    if (result.kind === 'locked') {
      await logAuditEvent({ req, userId: user.id, action: 'LOGIN_BLOCKED', targetType: 'User', targetId: user.id, details: { reason: 'Account locked' } });
      const minutesRemaining = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
      return res.status(423).json({ error: `Account is temporarily locked due to 5 consecutive wrong passwords. Please wait ${minutesRemaining} minute(s) or contact your administrator.` });
    }
    if (result.kind === 'inactive') {
      await logAuditEvent({ req, userId: user.id, action: 'LOGIN_BLOCKED', targetType: 'User', targetId: user.id, details: { reason: 'Account deactivated' } });
      return res.status(403).json({ error: 'Your account is deactivated. Please contact your administrator.' });
    }
    if (result.kind === 'invalid') {
      await logAuditEvent({ req, userId: user.id, action: result.attempts >= 5 ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', targetType: 'User', targetId: user.id,
        details: { email: user.email, attempt: result.attempts } });
      return res.status(401).json({ error: result.attempts >= 5 ? 'Account temporarily locked for 15 minutes due to 5 wrong passwords in a row.' : 'Invalid username or password.', attemptsRemaining: Math.max(0, 5 - result.attempts) });
    }

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
authRouter.post('/logout', requireLogoutAuth, async (req: Request, res: Response) => {
  try {
    await prisma.revokedToken.upsert({
      where: { tokenHash: req.authenticatedTokenHash! },
      create: { tokenHash: req.authenticatedTokenHash!, expiresAt: req.authenticatedTokenExpiresAt! },
      update: {},
    });
    // Expired tokens already fail signature verification; their digest rows can go.
    await prisma.revokedToken.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await logAuditEvent({ req, action: 'LOGOUT', targetType: 'User', targetId: req.user!.id });
    return res.json({ message: 'Signed out.' });
  } catch {
    return res.status(503).json({ error: 'Could not sign out this session. Please try again.' });
  }
});
