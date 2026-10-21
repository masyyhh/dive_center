import { withSerializableTransaction } from '../utils/transactions';
import { Router, Request, Response } from 'express';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { prisma } from '../db';
import { loadJwtSecret } from '../config/secrets';
import { requireAccountAuth, requirePasswordChangeAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/security';
import { authenticatorConfigured, consumeAuthenticatorProof, decryptSecret, encryptSecret, matchingStep, newAuthenticator, newRecoveryCodes, securityDigest, secretEquals } from '../services/authenticatorService';
import { logAuditEvent } from '../services/auditService';
import { passwordSchema, passwordPolicyMessage } from '../utils/password';

export const passwordRouter = Router();
passwordRouter.use((_req, res, next) => { res.setHeader?.('Cache-Control', 'no-store'); next(); });
const digest = (purpose: string, value: string) => createHmac('sha256', loadJwtSecret()).update(JSON.stringify([purpose, value])).digest('hex');
const invalidProof = 'Invalid account or code. Use an unused authenticator or recovery code. After five failed attempts, wait 15 minutes.';
const codeSchema = z.string().trim().min(6).max(32);

// Email recovery is retired, including previously issued email reset grants.
passwordRouter.post('/password-reset/request', authLimiter, (_req, res) => res.status(410).json({ error: 'Email recovery has been replaced. Enter your username and authenticator or recovery code.' }));

passwordRouter.get('/authenticator/status', requireAccountAuth, async (req, res) => {
  try {
    const binding = await prisma.authenticator.findUnique({ where: { userId: req.user!.id }, select: { enrolledAt: true } });
    return res.json({ enabled: Boolean(binding?.enrolledAt) });
  } catch { return res.status(500).json({ error: 'Unable to check authenticator setup.' }); }
});

passwordRouter.post('/authenticator/setup', authLimiter, requireAccountAuth, async (req, res) => {
  const parsed = z.object({ password: z.string().min(1).max(256), code: codeSchema.optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your current password.' });
  if (!authenticatorConfigured()) return res.status(503).json({ error: 'Authenticator setup is unavailable. Contact your administrator.' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.isActive || user.mustChangePassword || !await bcrypt.compare(parsed.data.password, user.passwordHash)) return res.status(400).json({ error: 'Unable to verify your current password.' });
    const enrollment = newAuthenticator(user.username || user.email || user.id);
    const qrCode = await QRCode.toDataURL(enrollment.uri, { errorCorrectionLevel: 'M', margin: 2, width: 240 });
    const saved = await withSerializableTransaction(prisma, async tx => {
      const currentUser = await tx.user.findUnique({ where: { id: user.id } });
      if (!currentUser?.isActive || currentUser.mustChangePassword || currentUser.passwordHash !== user.passwordHash) return false;
      const current = await tx.authenticator.findUnique({ where: { userId: user.id } });
      if (current?.lockedUntil && current.lockedUntil > new Date()) return false;
      if (current?.enrolledAt && !await consumeAuthenticatorProof(tx, user.id, parsed.data.code || '')) return false;
      const pending = { pendingCiphertext: encryptSecret(user.id, enrollment.secret), pendingExpiresAt: new Date(Date.now() + 10 * 60000), pendingCredentialHash: securityDigest('credential', user.passwordHash) };
      await tx.authenticator.upsert({ where: { userId: user.id }, create: { userId: user.id, ...pending }, update: pending });
      return true;
    });
    if (!saved) return res.status(400).json({ error: 'Unable to start setup. Verify your current authenticator or recovery code. After five failed attempts, wait 15 minutes.' });
    return res.json({ secret: enrollment.secret, qrCode, expiresInSeconds: 600 });
  } catch { return res.status(500).json({ error: 'Unable to start authenticator setup.' }); }
});

passwordRouter.post('/authenticator/confirm', authLimiter, requireAccountAuth, async (req, res) => {
  const parsed = z.object({ otp: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the six-digit code from your authenticator app.' });
  try {
    const recovery = newRecoveryCodes(req.user!.id);
    const confirmed = await withSerializableTransaction(prisma, async tx => {
      const user = await tx.user.findUnique({ where: { id: req.user!.id } });
      const binding = await tx.authenticator.findUnique({ where: { userId: req.user!.id } });
      if (!user?.isActive || user.mustChangePassword || user.passwordHash !== req.authenticatedPasswordHash || !binding?.pendingCiphertext || !binding.pendingExpiresAt || binding.pendingExpiresAt <= new Date() || !secretEquals(binding.pendingCredentialHash || '', securityDigest('credential', user.passwordHash)) || binding.lockedUntil && binding.lockedUntil > new Date()) return false;
      const step = matchingStep(decryptSecret(user.id, binding.pendingCiphertext), parsed.data.otp);
      if (step === null) {
        const attempts = binding.lockedUntil && binding.lockedUntil <= new Date() ? 1 : binding.failedAttempts + 1;
        await tx.authenticator.update({ where: { userId: user.id }, data: { failedAttempts: attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null } });
        return false;
      }
      const saved = await tx.authenticator.updateMany({ where: { userId: user.id, pendingCiphertext: binding.pendingCiphertext, version: binding.version }, data: {
        secretCiphertext: binding.pendingCiphertext, enrolledAt: new Date(), pendingCiphertext: null, pendingExpiresAt: null, pendingCredentialHash: null,
        version: randomUUID(), lastUsedStep: step, failedAttempts: 0, lockedUntil: null, recoveryCodeHashes: recovery.hashes,
      } });
      if (!saved.count) return false;
      await tx.passwordReset.deleteMany({ where: { userId: user.id } });
      return true;
    });
    if (!confirmed) return res.status(400).json({ error: 'Invalid or expired setup code. After five failed attempts, wait 15 minutes.' });
    await logAuditEvent({ req, userId: req.user!.id, action: 'AUTHENTICATOR_ENROLLED', targetType: 'User', targetId: req.user!.id });
    return res.json({ recoveryCodes: recovery.codes });
  } catch { return res.status(500).json({ error: 'Unable to confirm authenticator setup.' }); }
});

passwordRouter.post('/password-reset/verify', authLimiter, async (req: Request, res: Response) => {
  const parsed = z.object({ username: z.string().trim().min(1).max(254).transform(value => value.toLowerCase()), code: codeSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your username and authenticator or recovery code.' });
  if (!authenticatorConfigured()) return res.status(503).json({ error: 'Authenticator recovery is unavailable. Contact your administrator.' });
  try {
    const token = randomBytes(32).toString('hex');
    const result = await withSerializableTransaction(prisma, async tx => {
      const user = await tx.user.findUnique({ where: { username: parsed.data.username } });
      if (!user?.isActive) return null;
      const proof = await consumeAuthenticatorProof(tx, user.id, parsed.data.code);
      if (!proof) return null;
      const data = { otpHash: null, tokenHash: digest('reset-token', token), credentialHash: digest('credential', user.passwordHash), authenticatorVersion: proof.version, attempts: 0, requestedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60000) };
      await tx.passwordReset.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
      return { userId: user.id, method: proof.method };
    });
    if (!result) return res.status(400).json({ error: invalidProof });
    await logAuditEvent({ req, userId: result.userId, action: 'PASSWORD_RESET_VERIFIED', targetType: 'User', targetId: result.userId, details: { method: result.method } });
    return res.json({ resetToken: token });
  } catch { return res.status(500).json({ error: 'Unable to verify your recovery code. Try again later.' }); }
});

passwordRouter.post('/password-reset/complete', authLimiter, async (req: Request, res: Response) => {
  const parsed = z.object({ resetToken: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: !passwordSchema.safeParse(req.body.password).success ? passwordPolicyMessage : 'Invalid reset session. Verify another code.' });
  try {
    const tokenHash = digest('reset-token', parsed.data.resetToken);
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const result = await withSerializableTransaction(prisma, async tx => {
      const challenge = await tx.passwordReset.findUnique({ where: { tokenHash }, include: { user: { include: { authenticator: true } } } });
      if (!challenge || !challenge.authenticatorVersion || challenge.authenticatorVersion !== challenge.user.authenticator?.version || !challenge.user.authenticator?.enrolledAt || challenge.expiresAt <= new Date() || !challenge.user.isActive || !secretEquals(challenge.credentialHash, digest('credential', challenge.user.passwordHash))) return null;
      if (await bcrypt.compare(parsed.data.password, challenge.user.passwordHash)) return 'same';
      const updated = await tx.user.updateMany({ where: { id: challenge.userId, isActive: true, passwordHash: challenge.user.passwordHash }, data: {
        passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null,
      } });
      if (!updated.count) return null;
      await tx.passwordReset.deleteMany({ where: { userId: challenge.userId } });
      return challenge.userId;
    });
    if (result === 'same') return res.status(400).json({ error: 'Choose a password different from your current password.' });
    if (!result) return res.status(400).json({ error: 'Invalid or expired reset session. Verify another code.' });
    await logAuditEvent({ req, userId: result, action: 'PASSWORD_RESET', targetType: 'User', targetId: result });
    return res.json({ message: 'Password changed. Sign in with your new password.' });
  } catch { return res.status(500).json({ error: 'Unable to change your password. Try again later.' }); }
});

passwordRouter.post('/initial-password', authLimiter, requirePasswordChangeAuth, async (req: Request, res: Response) => {
  const parsed = passwordSchema.safeParse(req.body.password);
  if (!parsed.success) return res.status(400).json({ error: passwordPolicyMessage });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.isActive || !user.mustChangePassword || user.passwordHash !== req.authenticatedPasswordHash) return res.status(403).json({ error: 'Sign in again to change your initial password.' });
    if (await bcrypt.compare(parsed.data, user.passwordHash)) return res.status(400).json({ error: 'Choose a password different from the initial password.' });
    const passwordHash = await bcrypt.hash(parsed.data, 12);
    const changed = await prisma.user.updateMany({ where: { id: user.id, isActive: true, mustChangePassword: true, passwordHash: user.passwordHash }, data: {
      passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null,
    } });
    if (!changed.count) return res.status(403).json({ error: 'Your credentials changed. Sign in again.' });
    await logAuditEvent({ req, userId: user.id, action: 'INITIAL_PASSWORD_CHANGED', targetType: 'User', targetId: user.id });
    return res.json({ message: 'Password changed. Sign in with your new password.' });
  } catch {
    return res.status(500).json({ error: 'Unable to change your password. Try again later.' });
  }
});
