const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes, createHmac } = require('node:crypto');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('remediation');
const prisma = database.prisma;
process.env.JWT_SECRET = randomBytes(48).toString('hex'); delete process.env.JWT_SECRET_FILE;
const noop = (_req, _res, next) => next();
const stubs = { '../db': { prisma }, '../middleware/security': { authLimiter: noop } };
const auth = loadTypeScript('src/middleware/auth.ts', stubs);
const { authRouter } = loadTypeScript('src/routes/auth.routes.ts', stubs);
const { usersRouter } = loadTypeScript('src/routes/users.routes.ts', stubs);
const { propertiesRouter } = loadTypeScript('src/routes/properties.routes.ts', stubs);
const { passwordRouter } = loadTypeScript('src/routes/password.routes.ts', stubs);
const { presenceRouter } = loadTypeScript('src/routes/presence.routes.ts', stubs);
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const password = 'FixturePassword1!';
let tokens, users;
const call = (router, method, url, body = {}, token = tokens.admin) => request(router, method, url, { user: null, body, headers: token ? { authorization: `Bearer ${token}` } : {} });
const login = (value = password, router = authRouter) => call(router, 'POST', '/login', { username: 'target', password: value }, null);
const revokedHash = token => createHmac('sha256', process.env.JWT_SECRET).update(JSON.stringify(['revoked-token', token])).digest('hex');

test.beforeEach(async () => {
  await prisma.auditLog.deleteMany(); await prisma.bill.deleteMany(); await prisma.monthLock.deleteMany();
  await prisma.staffMember.deleteMany(); await prisma.userProperty.deleteMany(); await prisma.user.deleteMany();
  await prisma.revokedToken.deleteMany(); await prisma.property.deleteMany();
  await prisma.property.createMany({ data: [{ id: 'a', name: 'Centre A', code: 'AA' }, { id: 'b', name: 'Centre B', code: 'BB' }] });
  users = {}; tokens = {};
  const passwordHash = await bcrypt.hash(password, 4);
  for (const [id, role] of [['admin', 'GLOBAL_ADMIN'], ['manager', 'PROPERTY_MANAGER'], ['target', 'CENTRE_STAFF']]) {
    users[id] = await prisma.user.create({ data: { id, username: id, name: id, role, passwordHash,
      assignedProperties: { create: { propertyId: 'a' } }, authenticator: { create: { secretCiphertext: 'fixture', enrolledAt: new Date() } },
    } });
    tokens[id] = auth.signToken(users[id]);
  }
});
test.after(() => database.dispose());

test('concurrent login requests evaluate exactly five failures and preserve the lock', async () => {
  let comparisons = 0;
  const router = loadTypeScript('src/routes/auth.routes.ts', { ...stubs, bcryptjs: { ...bcrypt, compare: async (...args) => { comparisons++; return bcrypt.compare(...args); } } }).authRouter;
  const results = await Promise.all(Array.from({ length: 8 }, () => login('WrongPassword1!', router)));
  assert.equal(results.filter(r => r.status === 401).length, 5);
  assert.equal(results.filter(r => r.status === 423).length, 3);
  assert.equal(comparisons, 5);
  const target = await prisma.user.findUnique({ where: { id: 'target' } });
  assert.equal(target.failedLoginAttempts, 5); assert(target.lockedUntil > new Date());
  assert.equal((await login()).status, 423);
  await prisma.user.update({ where: { id: 'target' }, data: { lockedUntil: new Date(Date.now() - 1000) } });
  assert.equal((await login('WrongPassword1!')).body.attemptsRemaining, 4);
  assert.equal((await login()).status, 200);
  assert.equal((await prisma.user.findUnique({ where: { id: 'target' } })).failedLoginAttempts, 0);
});

test('same-second sessions are distinct and logout revokes only the presented token', async () => {
  const first = (await login()).body.token, second = (await login()).body.token;
  assert.notEqual(first, second); assert.notEqual(jwt.decode(first).jti, jwt.decode(second).jti);
  assert.equal((await call(authRouter, 'GET', '/me', {}, first)).status, 200);
  assert.equal((await call(authRouter, 'POST', '/logout', {}, first)).status, 200);
  assert.equal((await call(authRouter, 'GET', '/me', {}, first)).status, 401);
  assert.equal((await call(propertiesRouter, 'GET', '/', {}, first)).status, 401);
  assert.equal((await call(authRouter, 'GET', '/me', {}, second)).status, 200);
  const row = await prisma.revokedToken.findUnique({ where: { tokenHash: revokedHash(first) } });
  assert(row); assert(!JSON.stringify(row).includes(first));
});

test('prepatch tokens remain compatible but revocation covers all authentication modes', async () => {
  const credential = createHmac('sha256', process.env.JWT_SECRET).update(JSON.stringify(['target', users.target.passwordHash])).digest('hex');
  const legacy = jwt.sign({ id: 'target', credential }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '12h' });
  assert.equal((await call(authRouter, 'GET', '/me', {}, legacy)).status, 200);
  assert.equal((await call(authRouter, 'POST', '/logout', {}, legacy)).status, 200);
  assert.equal((await call(authRouter, 'GET', '/me', {}, legacy)).status, 401);
  await prisma.user.update({ where: { id: 'target' }, data: { mustChangePassword: true } });
  const initial = auth.signToken({ ...users.target, purpose: 'password-change' });
  await prisma.revokedToken.create({ data: { tokenHash: revokedHash(initial), expiresAt: new Date(Date.now() + 600000) } });
  assert.equal((await call(passwordRouter, 'POST', '/initial-password', { password: 'OtherPassword2!' }, initial)).status, 401);
});

test('failed revocation never acknowledges successful logout and can be retried', async () => {
  const failing = loadTypeScript('src/routes/auth.routes.ts', { ...stubs, '../db': { prisma: new Proxy(prisma, { get(target, key) { return key === 'revokedToken' ? { findUnique: args => target.revokedToken.findUnique(args), upsert: async () => { throw Error('fixture outage'); } } : target[key]; } }) } }).authRouter;
  assert.equal((await call(failing, 'POST', '/logout', {}, tokens.target)).status, 503);
  assert.equal((await call(authRouter, 'GET', '/me', {}, tokens.target)).status, 200);
  assert.equal((await call(authRouter, 'POST', '/logout', {}, tokens.target)).status, 200);
  assert.equal((await call(authRouter, 'GET', '/me', {}, tokens.target)).status, 401);
});

test('password reset rereads target/actor authority after hashing', async () => {
  for (const transition of ['promote', 'reassign', 'demote-actor', 'revoke-actor', 'change-actor-password', 'logout-actor', 'lock-actor']) {
    let entered, resume;
    const paused = new Promise(resolve => entered = resolve), released = new Promise(resolve => resume = resolve);
    const router = loadTypeScript('src/routes/users.routes.ts', { ...stubs, bcryptjs: { ...bcrypt, hash: async (...args) => { const result = await bcrypt.hash(...args); entered(); await released; return result; } } }).usersRouter;
    const before = await prisma.user.findUnique({ where: { id: 'target' } });
    const pending = call(router, 'POST', '/target/reset-password', { password: 'ManagerChosen1!', resetAuthenticator: true }, tokens.manager);
    await paused;
    if (transition === 'promote') assert.equal((await call(usersRouter, 'PUT', '/target', { role: 'GLOBAL_ADMIN' })).status, 200);
    if (transition === 'reassign') assert.equal((await call(usersRouter, 'PUT', '/target', { propertyIds: ['b'] })).status, 200);
    if (transition === 'demote-actor') assert.equal((await call(usersRouter, 'PUT', '/manager', { role: 'CENTRE_STAFF' })).status, 200);
    if (transition === 'revoke-actor') assert.equal((await call(usersRouter, 'PUT', '/manager', { propertyIds: [] })).status, 200);
    if (transition === 'change-actor-password') assert.equal((await call(usersRouter, 'POST', '/manager/reset-password', { password: 'OtherPassword2!' })).status, 200);
    if (transition === 'logout-actor') assert.equal((await call(authRouter, 'POST', '/logout', {}, tokens.manager)).status, 200);
    if (transition === 'lock-actor') await prisma.user.update({ where: { id: 'manager' }, data: { lockedUntil: new Date(Date.now() + 60000) } });
    resume(); assert.equal((await pending).status, 403, transition);
    assert.equal((await prisma.user.findUnique({ where: { id: 'target' } })).passwordHash, before.passwordHash);
    assert(await prisma.authenticator.findUnique({ where: { userId: 'target' } }));
    await prisma.user.update({ where: { id: 'target' }, data: { role: 'CENTRE_STAFF', assignedProperties: { deleteMany: {}, create: { propertyId: 'a' } } } });
    await prisma.user.update({ where: { id: 'manager' }, data: { role: 'PROPERTY_MANAGER', passwordHash: users.manager.passwordHash, mustChangePassword: false, lockedUntil: null, assignedProperties: { deleteMany: {}, create: { propertyId: 'a' } } } });
    await prisma.revokedToken.deleteMany({ where: { tokenHash: revokedHash(tokens.manager) } });
  }
  assert.equal((await call(usersRouter, 'POST', '/target/reset-password', { password: 'ManagerChosen1!', resetAuthenticator: true }, tokens.manager)).status, 200);
  assert.equal(await prisma.authenticator.count({ where: { userId: 'target' } }), 0);
});

test('oversized arrays abort before element validation and legitimate arrays retain schema behavior', async () => {
  const { z } = require('zod');
  const { boundedArray, validationIssues } = loadTypeScript('src/utils/validation.ts');
  let visits = 0;
  const schema = boundedArray(z.any().transform(value => { visits++; return value; }), 1000);
  assert.equal(schema.safeParse(Array(8000).fill({})).success, false); assert.equal(visits, 0);
  assert.equal(schema.safeParse(Array(1000).fill('valid')).success, true); assert.equal(visits, 1000);
  const presence = await call(presenceRouter, 'POST', '/day', { propertyId: 'a', date: '2026-10-28', records: Array.from({ length: 8000 }, () => ({})) }, tokens.target);
  assert.equal(presence.status, 400); assert.equal(presence.body.details.length, 1);
  assert.equal((await call(billsRouter, 'POST', '/', { propertyId: 'a', checkNumber: 1, businessDate: '2026-10-28', guestName: 'Guest', roomNumber: '100', items: Array(201).fill({}) }, tokens.target)).status, 400);
  const invalid = z.array(z.string()).safeParse(Array(100).fill(null));
  assert.equal(validationIssues(invalid.error).length, 20);
});


test('a locked or inactive account can still revoke its signed-in session', async () => {
  for (const state of [{ lockedUntil: new Date(Date.now() + 60000) }, { isActive: false }]) {
    const token = auth.signToken(users.target);
    await prisma.user.update({ where: { id: 'target' }, data: state });
    assert.equal((await call(authRouter, 'POST', '/logout', {}, token)).status, 200);
    await prisma.user.update({ where: { id: 'target' }, data: { lockedUntil: null, isActive: true } });
    assert.equal((await call(authRouter, 'GET', '/me', {}, token)).status, 401);
  }
});
