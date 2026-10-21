import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { readSecret } from '../config/secrets';

const key = () => {
  const value = readSecret('AUTHENTICATOR_ENCRYPTION_KEY');
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Authenticator encryption key is not configured.');
  return Buffer.from(value, 'hex');
};
export const authenticatorConfigured = () => { try { key(); return true; } catch { return false; } };
export const securityDigest = (purpose: string, value: string) => createHmac('sha256', key()).update(JSON.stringify([purpose, value])).digest('hex');
export const secretEquals = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const encryptSecret = (userId: string, secret: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join('.');
};
export const decryptSecret = (userId: string, encrypted: string) => {
  const [iv, tag, ciphertext] = encrypted.split('.').map(value => Buffer.from(value, 'hex'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
};
export const totp = (secret: string, label = '') => new OTPAuth.TOTP({ issuer: 'Dive Centre Manager', label, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
export const newAuthenticator = (label: string) => {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, uri: totp(secret, label).toString() };
};
export const matchingStep = (secret: string, token: string, now = Date.now()) => {
  if (!/^\d{6}$/.test(token)) return null;
  const delta = totp(secret).validate({ token, window: 1, timestamp: now });
  return delta === null ? null : Math.floor(now / 30000) + delta;
};
export const newRecoveryCodes = (userId: string) => {
  const codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex').match(/.{4}/g)!.join('-'));
  return { codes, hashes: JSON.stringify(codes.map(code => securityDigest(`backup:${userId}`, code.replace(/-/g, '')))) };
};

// Called inside a database transaction. Both successful proofs and failed guesses are persisted.
export const consumeAuthenticatorProof = async (tx: any, userId: string, code: string) => {
  const binding = await tx.authenticator.findUnique({ where: { userId } });
  if (!binding?.enrolledAt || !binding.secretCiphertext || binding.lockedUntil && binding.lockedUntil > new Date()) return null;
  const hashes: string[] = JSON.parse(binding.recoveryCodeHashes);
  const normalized = code.trim().toLowerCase().replace(/-/g, '');
  const backupHash = /^[a-f0-9]{20}$/.test(normalized) ? securityDigest(`backup:${userId}`, normalized) : '';
  const backupIndex = backupHash ? hashes.findIndex(hash => secretEquals(hash, backupHash)) : -1;
  const step = /^\d{6}$/.test(code) ? matchingStep(decryptSecret(userId, binding.secretCiphertext), code) : null;
  if (backupIndex < 0 && (step === null || step <= binding.lastUsedStep)) {
    const attempts = binding.lockedUntil && binding.lockedUntil <= new Date() ? 1 : binding.failedAttempts + 1;
    await tx.authenticator.update({ where: { userId }, data: { failedAttempts: attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null } });
    return null;
  }
  if (backupIndex >= 0) hashes.splice(backupIndex, 1);
  const consumed = await tx.authenticator.updateMany({ where: { userId, version: binding.version, lastUsedStep: binding.lastUsedStep, recoveryCodeHashes: binding.recoveryCodeHashes }, data: {
    lastUsedStep: backupIndex >= 0 ? binding.lastUsedStep : step!, recoveryCodeHashes: JSON.stringify(hashes), failedAttempts: 0, lockedUntil: null,
  } });
  return consumed.count ? { version: binding.version, method: backupIndex >= 0 ? 'recovery code' : 'authenticator' } : null;
};
