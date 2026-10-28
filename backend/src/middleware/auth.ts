import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { loadJwtSecret } from '../config/secrets';
import { prisma } from '../db';

const JWT_SECRET = loadJwtSecret();
const credentialBinding = (id: string, hash: string) => createHmac('sha256', JWT_SECRET).update(JSON.stringify([id, hash])).digest('hex');

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
  role: 'GLOBAL_ADMIN' | 'PROPERTY_MANAGER' | 'CENTRE_STAFF';
  assignedPropertyIds: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      authenticatedPasswordHash?: string;
      authenticatedTokenHash?: string;
      authenticatedTokenExpiresAt?: Date;
    }
  }
}

export const signToken = (payload: { id: string; email: string | null; role: string; passwordHash: string; purpose?: 'password-change' }) => {
  const { passwordHash, ...identity } = payload;
  return jwt.sign({ ...identity, credential: credentialBinding(identity.id, passwordHash) }, JWT_SECRET, {
    algorithm: 'HS256',
    jwtid: randomUUID(),
    expiresIn: (payload.purpose ? '10m' : process.env.JWT_EXPIRES_IN || '12h') as any,
  });
};


const authenticate = (mode: 'workspace' | 'account' | 'initial' | 'logout') => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      return res.status(401).json({ error: 'Session expired or invalid token. Please sign in again.' });
    }

    if (!decoded || typeof decoded !== 'object' || typeof decoded.id !== 'string' || typeof decoded.credential !== 'string' || !/^[a-f0-9]{64}$/.test(decoded.credential)) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    // Password binding handles credential changes; this digest revokes only this session.
    if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp)) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    const tokenHash = createHmac('sha256', JWT_SECRET).update(JSON.stringify(['revoked-token', token])).digest('hex');
    if (await prisma.revokedToken.findUnique({ where: { tokenHash }, select: { tokenHash: true } })) {
      return res.status(401).json({ error: 'Session signed out. Please sign in again.' });
    }
    req.authenticatedTokenHash = tokenHash;
    req.authenticatedTokenExpiresAt = new Date(decoded.exp * 1000);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        authenticator: { select: { enrolledAt: true } },
        assignedProperties: {
          select: { propertyId: true, property: { select: { deletedAt: true } } },
        },
      },
    });

    if (!user || (!user.isActive && mode !== 'logout')) {
      return res.status(401).json({ error: 'User account is inactive or no longer exists.' });
    }

    if (!timingSafeEqual(Buffer.from(decoded.credential, 'hex'), Buffer.from(credentialBinding(user.id, user.passwordHash), 'hex'))) {
      return res.status(401).json({ error: 'Password changed. Please sign in again.' });
    }

    if (mode === 'initial' ? decoded.purpose !== 'password-change' || !user.mustChangePassword : decoded.purpose !== undefined || user.mustChangePassword) {
      return res.status(403).json({ error: 'You must change your initial password before continuing.' });
    }

    if (mode === 'workspace' && !user.authenticator?.enrolledAt) {
      return res.status(403).json({ error: 'Set up your personal authenticator before entering the workspace.', code: 'AUTHENTICATOR_SETUP_REQUIRED' });
    }
    // Global administrators retain read access to historical data, but cannot add work to a removed property.
    if (user.role === 'GLOBAL_ADMIN' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const selectedIds = [req.body?.propertyId, req.query?.propertyId].filter((id): id is string => typeof id === 'string' && Boolean(id));
      if (selectedIds.length && await prisma.property.findFirst({ where: { id: { in: selectedIds }, deletedAt: { not: null } }, select: { id: true } })) {
        return res.status(410).json({ error: 'This property has been removed from the workspace. Its history is retained.' });
      }
    }
    req.authenticatedPasswordHash = user.passwordHash;

    // Check account lockout
    if (mode !== 'logout' && user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesRemaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / (60 * 1000));
      return res.status(423).json({
        error: `Account is temporarily locked. Please try again in ${minutesRemaining} minutes or contact your administrator.`,
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as any,
      assignedPropertyIds: user.assignedProperties.filter(p => !p.property?.deletedAt).map((p) => p.propertyId),
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication.' });
  }
};

export const requireAuth = authenticate('workspace');
export const requirePasswordChangeAuth = authenticate('initial');

export const requireAccountAuth = authenticate('account');

// Revoking this signed token must remain possible even when the account is locked.
export const requireLogoutAuth = authenticate('logout');
