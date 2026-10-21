const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const OTPAuth = require('otpauth');

const { createTestDatabase } = require('./helpers/postgres.cjs');
const testDatabase = createTestDatabase('authenticator');
const prisma = testDatabase.prisma;
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.AUTHENTICATOR_ENCRYPTION_KEY = randomBytes(32).toString('hex');
delete process.env.JWT_SECRET_FILE;
delete process.env.AUTHENTICATOR_ENCRYPTION_KEY_FILE;
const audits = [];
const auth = loadTypeScript('src/middleware/auth.ts', { '../db': { prisma } });
const service = loadTypeScript('src/services/authenticatorService.ts');
const stubs = {
  '../db': { prisma },
  '../middleware/security': { authLimiter: (_req, _res, next) => next() },
  '../services/auditService': { logAuditEvent: async ({ req, ...event }) => audits.push(event) },
};
const { passwordRouter } = loadTypeScript('src/routes/password.routes.ts', stubs);
const { authRouter } = loadTypeScript('src/routes/auth.routes.ts', stubs);
const { usersRouter } = loadTypeScript('src/routes/users.routes.ts', stubs);
const initial = 'Initial1!abc', nextPassword = 'NewPass1!abc';
const post = (route, body, token) => request(passwordRouter, 'POST', route, { user: null, body, headers: token ? { authorization: `Bearer ${token}` } : {} });
const tokenFor = async (id = 'staff') => auth.signToken(await prisma.user.findUnique({ where: { id } }));
const verify = code => post('/password-reset/verify', { username: 'staff', code });
const complete = (resetToken, password = nextPassword) => post('/password-reset/complete', { resetToken, password });
const allow = async (token, middleware = auth.requireAuth) => {
  let allowed = false, status = 200;
  await middleware({ headers: { authorization: `Bearer ${token}` } }, { status(code) { status = code; return this; }, json() {} }, () => { allowed = true; });
  return { allowed, status };
};
const enroll = async (id = 'staff') => {
  const token = await tokenFor(id);
  const start = await post('/authenticator/setup', { password: initial }, token);
  assert.equal(start.status, 200);
  const code = service.totp(start.body.secret).generate();
  const confirmed = await post('/authenticator/confirm', { otp: code }, token);
  assert.equal(confirmed.status, 200);
  return { token, secret: start.body.secret, codes: confirmed.body.recoveryCodes, code };
};
test.before(async () => {
  await prisma.property.createMany({ data: [{ id: 'a', name: 'A', code: 'A' }, { id: 'b', name: 'B', code: 'B' }] });
});
test.beforeEach(async () => {
  await prisma.user.deleteMany();
  await prisma.user.create({ data: { id: 'staff', username: 'staff', name: 'Staff', role: 'CENTRE_STAFF', passwordHash: await bcrypt.hash(initial, 4), assignedProperties: { create: { propertyId: 'a' } } } });
  audits.length = 0;
});
test.after(async () => { await testDatabase.dispose(); });

test('enrollment requires a current password, confirms TOTP, encrypts secrets, and gates workspace access', async () => {
  const token = await tokenFor();
  assert.equal((await allow(token)).status, 403);
  assert.equal((await allow(token, auth.requireAccountAuth)).allowed, true);
  assert.equal((await post('/authenticator/setup', { password: initial })).status, 401);
  assert.equal((await post('/authenticator/setup', { password: 'wrong' }, token)).status, 400);
  const start = await post('/authenticator/setup', { password: initial }, token);
  assert.equal(start.status, 200);
  assert.match(start.body.qrCode, /^data:image\/png;base64,/);
  const pending = await prisma.authenticator.findUnique({ where: { userId: 'staff' } });
  assert.equal(pending.enrolledAt, null);
  assert.equal(pending.pendingCiphertext.includes(start.body.secret), false);
  assert.equal((await allow(token)).status, 403);
  const code = service.totp(start.body.secret).generate();
  const confirmed = await post('/authenticator/confirm', { otp: code }, token);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.recoveryCodes.length, 10);
  assert.equal((await allow(token)).allowed, true);
  const binding = await prisma.authenticator.findUnique({ where: { userId: 'staff' } });
  assert.equal(binding.pendingCiphertext, null);
  assert.equal(service.decryptSecret('staff', binding.secretCiphertext), start.body.secret);
  assert.throws(() => service.decryptSecret('different-user', binding.secretCiphertext));
  for (const raw of [start.body.secret, code, ...confirmed.body.recoveryCodes]) assert.equal(JSON.stringify(audits).includes(raw), false);
  assert.equal(binding.recoveryCodeHashes.includes(confirmed.body.recoveryCodes[0]), false);
});
test('each account gets an independent binding even with a shared email; no email is also supported', async () => {
  await prisma.user.update({ where: { id: 'staff' }, data: { email: 'group@example.test' } });
  await prisma.user.create({ data: { id: 'other', username: 'other', email: 'group@example.test', name: 'Other', passwordHash: await bcrypt.hash(initial, 4) } });
  const one = await enroll(); const two = await enroll('other');
  assert.notEqual(one.secret, two.secret);
  const wrong = await post('/password-reset/verify', { username: 'other', code: one.codes[0] });
  assert.equal(wrong.status, 400);
  assert.equal((await post('/password-reset/verify', { username: 'group@example.test', code: one.codes[1] })).status, 400);
  const login = await request(authRouter, 'POST', '/login', { body: { username: 'OTHER', password: initial }, headers: {} });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.username, 'other');
  assert.equal(JSON.stringify(login.body).includes(two.secret), false);
});
test('all roles recover with a single-use code; reset grants are single-use and old sessions stop working', async () => {
  for (const role of ['GLOBAL_ADMIN', 'PROPERTY_MANAGER', 'CENTRE_STAFF']) {
    await prisma.authenticator.deleteMany(); await prisma.passwordReset.deleteMany();
    await prisma.user.update({ where: { id: 'staff' }, data: { role, passwordHash: await bcrypt.hash(initial, 4), mustChangePassword: false } });
    const { token, codes } = await enroll();
    await prisma.user.update({ where: { id: 'staff' }, data: { lockedUntil: new Date(Date.now() + 60000), failedLoginAttempts: 5 } });
    const verified = await verify(codes[0]);
    assert.equal(verified.status, 200);
    assert.equal((await verify(codes[0])).status, 400);
    assert.equal((await complete(verified.body.resetToken)).status, 200);
    assert.equal((await complete(verified.body.resetToken)).status, 400);
    const updated = await prisma.user.findUnique({ where: { id: 'staff' } });
    assert.equal(await bcrypt.compare(nextPassword, updated.passwordHash), true);
    assert.equal(updated.lockedUntil, null); assert.equal(updated.failedLoginAttempts, 0);
    assert.equal((await allow(token)).status, 401);
    assert.equal((await allow(auth.signToken(updated))).allowed, true);
  }
});
test('TOTP codes verify within the clock window and cannot be replayed, including setup codes', async () => {
  const { secret, code } = await enroll();
  assert.equal((await verify(code)).status, 400);
  // Setup consumes the setup code; simulate a later use of the same binding without sleeping.
  await prisma.authenticator.update({ where: { userId: 'staff' }, data: { lastUsedStep: -1 } });
  const current = service.totp(secret).generate();
  assert.equal((await verify(current)).status, 200);
  assert.equal((await verify(current)).status, 400);
  const timestamp = 1760000000000;
  const fixed = service.totp(secret).generate({ timestamp });
  assert.notEqual(service.matchingStep(secret, fixed, timestamp + 30000), null);
  assert.equal(service.matchingStep(secret, fixed, timestamp + 120000), null);
});
test('unknown, unenrolled, inactive accounts and wrong codes have generic responses; five failures lock verification', async () => {
  const absent = await post('/password-reset/verify', { username: 'absent', code: '000000' });
  assert.deepEqual(await verify('000000'), absent);
  const { secret, codes } = await enroll();
  let wrong = '000000';
  while (service.matchingStep(secret, wrong) !== null) wrong = String(Number(wrong) + 1).padStart(6, '0');
  for (let i = 0; i < 5; i++) assert.deepEqual(await verify(wrong), absent);
  assert.equal((await verify(codes[0])).status, 400);
  const binding = await prisma.authenticator.findUnique({ where: { userId: 'staff' } });
  assert.equal(binding.failedAttempts, 5); assert.ok(binding.lockedUntil > new Date());
  await prisma.authenticator.update({ where: { userId: 'staff' }, data: { lockedUntil: new Date(0) } });
  assert.equal((await verify(codes[0])).status, 200);
  await prisma.user.update({ where: { id: 'staff' }, data: { isActive: false } });
  assert.deepEqual(await verify(codes[1]), absent);
});
test('pending enrollment expires, throttles guesses, and is invalidated by password changes', async () => {
  const token = await tokenFor();
  const start = await post('/authenticator/setup', { password: initial }, token);
  const code = service.totp(start.body.secret).generate();
  await prisma.authenticator.update({ where: { userId: 'staff' }, data: { pendingExpiresAt: new Date(0) } });
  assert.equal((await post('/authenticator/confirm', { otp: code }, token)).status, 400);
  await prisma.authenticator.update({ where: { userId: 'staff' }, data: { pendingExpiresAt: new Date(Date.now() + 60000), pendingCredentialHash: 'changed' } });
  assert.equal((await post('/authenticator/confirm', { otp: code }, token)).status, 400);
  await prisma.authenticator.update({ where: { userId: 'staff' }, data: { pendingCredentialHash: service.securityDigest('credential', (await prisma.user.findUnique({ where: { id: 'staff' } })).passwordHash) } });
  let wrong = '000000'; while (service.matchingStep(start.body.secret, wrong) !== null) wrong = String(Number(wrong) + 1).padStart(6, '0');
  for (let i = 0; i < 5; i++) assert.equal((await post('/authenticator/confirm', { otp: wrong }, token)).status, 400);
  assert.equal((await post('/authenticator/confirm', { otp: code }, token)).status, 400);
});
test('replacement requires the current factor and confirmation, and invalidates old codes and reset grants', async () => {
  const { token, secret, codes } = await enroll();
  const grant = (await verify(codes[0])).body.resetToken;
  assert.equal((await post('/authenticator/setup', { password: initial }, token)).status, 400);
  const replacement = await post('/authenticator/setup', { password: initial, code: codes[1] }, token);
  assert.equal(replacement.status, 200);
  assert.equal(service.decryptSecret('staff', (await prisma.authenticator.findUnique({ where: { userId: 'staff' } })).secretCiphertext), secret);
  const confirmed = await post('/authenticator/confirm', { otp: service.totp(replacement.body.secret).generate() }, token);
  assert.equal(confirmed.status, 200);
  assert.equal((await complete(grant)).status, 400);
  assert.equal((await verify(codes[2])).status, 400);
  assert.equal((await verify(confirmed.body.recoveryCodes[0])).status, 200);
});
test('expired grants, changed credentials, and changed bindings cannot complete a reset', async () => {
  const { codes } = await enroll();
  for (const mutation of ['expire', 'binding', 'password']) {
    const verified = await verify(codes[['expire', 'binding', 'password'].indexOf(mutation)]);
    assert.equal(verified.status, 200);
    if (mutation === 'expire') await prisma.passwordReset.update({ where: { userId: 'staff' }, data: { expiresAt: new Date(0) } });
    if (mutation === 'binding') await prisma.authenticator.update({ where: { userId: 'staff' }, data: { version: 'changed-version' } });
    if (mutation === 'password') await prisma.user.update({ where: { id: 'staff' }, data: { passwordHash: await bcrypt.hash(initial, 4) } });
    assert.equal((await complete(verified.body.resetToken)).status, 400);
  }
});
test('password policy, password reuse prevention, and retired email grants are enforced', async () => {
  const { codes } = await enroll();
  const token = (await verify(codes[0])).body.resetToken;
  for (const password of ['Short1!', 'abcdefghij1!', 'ABCDEFGHIJ1!', 'Abcdefghijk!', 'Abcdefghijk1', 'Abcdefgh 1!a', null, initial]) assert.equal((await complete(token, password)).status, 400);
  await prisma.passwordReset.update({ where: { userId: 'staff' }, data: { authenticatorVersion: null } });
  assert.equal((await complete(token)).status, 400);
  assert.equal((await post('/password-reset/request', { email: 'staff@example.test' })).status, 410);
});
test('initial passwords must be changed before enrollment, then enrollment is required before workspace access', async () => {
  await prisma.user.update({ where: { id: 'staff' }, data: { mustChangePassword: true } });
  const login = await request(authRouter, 'POST', '/login', { body: { username: 'staff', password: initial }, headers: {} });
  assert.equal(login.body.passwordChangeRequired, true); assert.equal(login.body.token, undefined);
  const token = login.body.changeToken;
  assert.equal((await post('/authenticator/setup', { password: initial }, token)).status, 403);
  assert.equal((await post('/initial-password', { password: initial }, token)).status, 400);
  assert.equal((await post('/initial-password', { password: nextPassword }, token)).status, 200);
  assert.equal((await post('/initial-password', { password: nextPassword }, token)).status, 401);
  const user = await prisma.user.findUnique({ where: { id: 'staff' } });
  assert.equal((await allow(auth.signToken(user))).status, 403);
});
test('account managers can create username-only staff, shared emails, and recover a lost authenticator only in scope', async () => {
  await prisma.user.update({ where: { id: 'staff' }, data: { role: 'PROPERTY_MANAGER' } });
  const { token } = await enroll();
  const invoke = (body, method = 'POST', route = '/') => request(usersRouter, method, route, { user: null, headers: { authorization: `Bearer ${token}` }, body });
  const body = { username: 'new.staff', name: 'New User', password: nextPassword, role: 'CENTRE_STAFF', propertyIds: ['a'] };
  for (const patch of [{ role: 'GLOBAL_ADMIN' }, { role: 'PROPERTY_MANAGER' }, { propertyIds: ['b'] }, { propertyIds: ['a', 'b'] }, { propertyIds: [] }]) assert.equal((await invoke({ ...body, ...patch })).status, 403);
  assert.equal((await invoke(body)).status, 201);
  const created = await prisma.user.findUnique({ where: { username: body.username } });
  assert.equal(created.email, null); assert.equal(created.mustChangePassword, true);
  assert.equal(await bcrypt.compare(nextPassword, created.passwordHash), true);
  assert.equal((await invoke({ ...body, username: 'shared.one', email: 'group@example.test' })).status, 201);
  assert.equal((await invoke({ ...body, username: 'shared.two', email: 'group@example.test' })).status, 201);
  assert.equal((await invoke({ ...body, username: 'SHARED.ONE' })).status, 400);
  await prisma.authenticator.create({ data: { userId: created.id, enrolledAt: new Date(), secretCiphertext: 'fixture' } });
  assert.equal((await invoke({ password: nextPassword, resetAuthenticator: true }, 'POST', `/${created.id}/reset-password`)).status, 200);
  assert.equal(await prisma.authenticator.findUnique({ where: { userId: created.id } }), null);
  assert.equal((await prisma.user.findUnique({ where: { id: created.id } })).mustChangePassword, true);
  assert.equal((await invoke({ password: nextPassword, resetAuthenticator: true }, 'POST', '/staff/reset-password')).status, 403);
});
test('authenticator secrets require a valid independent encryption key', () => {
  const key = process.env.AUTHENTICATOR_ENCRYPTION_KEY;
  try {
    delete process.env.AUTHENTICATOR_ENCRYPTION_KEY;
    assert.equal(service.authenticatorConfigured(), false);
    process.env.AUTHENTICATOR_ENCRYPTION_KEY = 'invalid';
    assert.equal(service.authenticatorConfigured(), false);
  } finally { process.env.AUTHENTICATOR_ENCRYPTION_KEY = key; }
});


test('concurrent PostgreSQL requests count every failed authenticator guess and consume each backup code once', async () => {
  const { codes } = await enroll();
  const simultaneous = await Promise.all([verify(codes[0]), verify(codes[0])]);
  assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 400]);
  const failures = await Promise.all(Array.from({ length: 5 }, () => verify('invalid-recovery-code')));
  assert.equal(failures.every(result => result.status === 400), true);
  const binding = await prisma.authenticator.findUnique({ where: { userId: 'staff' } });
  // The rejected duplicate above is a failed guess too.
  assert.ok(binding.failedAttempts >= 5);
  assert.ok(binding.lockedUntil > new Date());
  assert.equal((await verify(codes[1])).status, 400);
});
