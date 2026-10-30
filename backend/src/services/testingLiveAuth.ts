import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { prisma } from '../db';
import { readSecret } from '../config/secrets';
import type { Request, Response, NextFunction } from 'express';

export const testingLiveAuthEnabled = () => process.env.TESTING_LIVE_AUTH === 'true';
export class TestingAuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const denied = () => new TestingAuthError(403, 'This live account is not selected for testing. Contact your administrator.');
const identitySchema = z.object({ user: z.object({
  id: z.string().min(1).max(100), username: z.string().min(1).max(254), name: z.string().min(1).max(200),
  email: z.string().max(254).nullish(), role: z.enum(['GLOBAL_ADMIN', 'PROPERTY_MANAGER', 'CENTRE_STAFF']),
  authenticatorEnabled: z.literal(true), isActive: z.boolean().optional(),
  assignedProperties: z.array(z.object({
    id: z.string().min(1).max(100), code: z.string().min(1).max(50), name: z.string().min(1).max(200),
    currency: z.string().max(10).default('USD'), currencySymbol: z.string().max(10).default('$'),
    taxRate: z.number().finite().min(0).max(100).default(16), serviceChargeRate: z.number().finite().min(0).max(100).default(10),
    isActive: z.boolean().default(true), deletedAt: z.unknown().optional(),
  })).max(1000),
}) });
type Identity = z.infer<typeof identitySchema>['user'];
const tokenDigest = (token: string) => createHmac('sha256', readSecret('JWT_SECRET')).update(`testing-live:${token}`).digest('hex');
const cipherKey = () => {
  const key = readSecret('AUTHENTICATOR_ENCRYPTION_KEY');
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new TestingAuthError(503, 'Testing authentication is not configured.');
  return Buffer.from(key, 'hex');
};
const seal = (token: string) => {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv);
  cipher.setAAD(Buffer.from('testing-live-session-v1'));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
};
const unseal = (value: string) => {
  const data = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', cipherKey(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from('testing-live-session-v1')); decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
};
const allowed = (id: string) => {
  try {
    const ids = z.array(z.string().min(1).max(100)).max(200).parse(JSON.parse(readFileSync(process.env.TESTING_ALLOWED_USER_IDS_FILE || '', 'utf8')));
    if (!ids.includes(id)) throw denied();
  } catch (error) {
    if (error instanceof TestingAuthError) throw error;
    throw new TestingAuthError(503, 'The selected testing user list is unavailable.');
  }
};
export const verifyLiveIdentity = async (token: string): Promise<Identity> => {
  // One fixed read-only live endpoint. Never relay caller-supplied URLs, paths,
  // redirects, cookies, property headers, or business mutations to production.
  let origin: URL;
  try {
    origin = new URL(process.env.TESTING_LIVE_AUTH_ORIGIN || '');
    if (origin.protocol !== 'https:' || origin.origin !== process.env.TESTING_LIVE_AUTH_ORIGIN || origin.username || origin.password) throw Error();
  } catch { throw new TestingAuthError(503, 'The live sign-in service is not configured.'); }
  let response: globalThis.Response;
  try {
    response = await fetch(`${origin.origin}/api/auth/me`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' },
      redirect: 'error', signal: AbortSignal.timeout(5000) });
  } catch { throw new TestingAuthError(503, 'Live sign-in could not be verified. Try again shortly.'); }
  if (response.status === 401 || response.status === 403 || response.status === 423) throw new TestingAuthError(401, 'Sign in to the live version again before opening testing.');
  if (!response.ok) throw new TestingAuthError(503, 'Live sign-in could not be verified. Try again shortly.');
  let identity: Identity;
  try {
    const text = await response.text(); if (text.length > 256 * 1024) throw Error();
    identity = identitySchema.parse(JSON.parse(text)).user;
    if (identity.isActive === false) throw Error();
  } catch { throw new TestingAuthError(403, 'Complete your account and authenticator setup in the live version first.'); }
  allowed(identity.id);
  return identity;
};
const synchronize = async (identity: Identity) => {
  const id = `live:${identity.id}`;
  const properties = identity.assignedProperties.filter(property => property.isActive && !property.deletedAt);
  return prisma.$transaction(async tx => {
    // Only property shells are copied. Live bills, staff, payroll, PMS bindings,
    // passwords, authenticator secrets and recovery codes never enter testing.
    for (const property of properties) {
      const { id: propertyId, code, name, currency, currencySymbol, taxRate, serviceChargeRate } = property;
      await tx.property.upsert({ where: { id: propertyId }, create: { id: propertyId, code, name, currency, currencySymbol, taxRate, serviceChargeRate }, update: {} });
    }
    const user = await tx.user.upsert({ where: { id },
      create: { id, username: `live:${identity.id}`, name: identity.name, email: identity.email, role: identity.role, passwordHash: '!LIVE-AUTH-ONLY' },
      update: { name: identity.name, email: identity.email, role: identity.role, isActive: true, deletedAt: null, mustChangePassword: false },
    });
    await tx.userProperty.deleteMany({ where: { userId: id, propertyId: { notIn: properties.map(property => property.id) } } });
    for (const property of properties) await tx.userProperty.upsert({ where: { userId_propertyId: { userId: id, propertyId: property.id } }, create: { userId: id, propertyId: property.id }, update: {} });
    return user;
  });
};
export const createTestingLiveSession = async (liveToken: string) => {
  const identity = await verifyLiveIdentity(liveToken);
  const user = await synchronize(identity);
  const token = `test_live_${randomBytes(32).toString('hex')}`;
  await prisma.testingLiveSession.create({ data: { userId: user.id, liveUserId: identity.id, tokenHash: tokenDigest(token),
    liveTokenCiphertext: seal(liveToken), expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) } });
  await prisma.testingLiveSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return { token, user: await testingUserResponse(user.id, identity.username) };
};
export const testingUserResponse = async (id: string, username: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, include: { assignedProperties: { include: { property: true } } } });
  const properties = user.role === 'GLOBAL_ADMIN'
    ? await prisma.property.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: 'asc' } })
    : user.assignedProperties.map(assignment => assignment.property).filter(property => property.isActive && !property.deletedAt);
  return { id: user.id, username, email: user.email, name: user.name, role: user.role, isActive: user.isActive,
    authenticatorEnabled: true, authenticationSource: 'live', assignedProperties: properties };
};
export const authenticateTestingLive = async (req: Request, res: Response, next: NextFunction, logout = false) => {
  let sessionId: string | undefined;
  try {
    const token = req.headers.authorization?.match(/^Bearer (test_live_[a-f0-9]{64})$/)?.[1];
    if (!token) throw new TestingAuthError(401, 'Connect your live sign-in to enter testing.');
    const session = await prisma.testingLiveSession.findUnique({ where: { tokenHash: tokenDigest(token) }, include: { user: { include: { assignedProperties: { select: { propertyId: true } } } } } });
    if (!session || session.expiresAt <= new Date()) throw new TestingAuthError(401, 'Your testing session expired. Connect your live sign-in again.');
    sessionId = session.id;
    if (session.userId !== `live:${session.liveUserId}`) throw denied();
    let user = session.user;
    if (!logout) {
      allowed(session.liveUserId);
      const identity = await verifyLiveIdentity(unseal(session.liveTokenCiphertext));
      if (identity.id !== session.liveUserId) throw denied();
      await synchronize(identity);
      req.testingLiveUsername = identity.username;
      user = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { assignedProperties: { select: { propertyId: true } } } });
    }
    req.testingLiveSessionId = session.id;
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role as any, assignedPropertyIds: user.assignedProperties.map(assignment => assignment.propertyId) };
    if (!logout && user.role === 'GLOBAL_ADMIN' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const ids = [req.body?.propertyId, req.query?.propertyId].filter((id): id is string => typeof id === 'string' && Boolean(id));
      if (ids.length && await prisma.property.findFirst({ where: { id: { in: ids }, deletedAt: { not: null } } })) return res.status(410).json({ error: 'This testing property has been removed.' });
    }
    return next();
  } catch (error) {
    if (sessionId && error instanceof TestingAuthError && [401, 403].includes(error.status)) await prisma.testingLiveSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
    return res.status(error instanceof TestingAuthError ? error.status : 503).json({ error: error instanceof TestingAuthError ? error.message : 'Testing authentication is temporarily unavailable.' });
  }
};
