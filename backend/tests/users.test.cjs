const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('users');
const prisma = database.prisma;
process.env.JWT_SECRET = randomBytes(48).toString('hex');
delete process.env.JWT_SECRET_FILE;
const stubs = { '../db': { prisma } };
const { signToken } = loadTypeScript('src/middleware/auth.ts', stubs);
const { usersRouter } = loadTypeScript('src/routes/users.routes.ts', stubs);
const tokens = {};
const call = (method, url, body = {}, account = 'admin') => request(usersRouter, method, url, {
  user: null, body, headers: tokens[account] ? { authorization: `Bearer ${tokens[account]}` } : {},
});
const remove = (account = 'admin', confirmationUsername = 'target') => call('DELETE', '/target', { confirmationUsername }, account);

test.beforeEach(async () => {
  await prisma.auditLog.deleteMany(); await prisma.bill.deleteMany(); await prisma.monthLock.deleteMany();
  await prisma.staffMember.deleteMany(); await prisma.userProperty.deleteMany();
  await prisma.authenticator.deleteMany(); await prisma.passwordReset.deleteMany();
  await prisma.user.deleteMany(); await prisma.property.deleteMany();
  await prisma.property.createMany({ data: [
    { id: 'a', name: 'Centre A', code: 'AA' }, { id: 'b', name: 'Centre B', code: 'BB' },
    { id: 'inactive', name: 'Inactive', code: 'IN', isActive: false },
    { id: 'removed', name: 'Removed', code: 'RM', isActive: false, deletedAt: new Date() },
  ] });
  for (const [id, role] of [['admin', 'GLOBAL_ADMIN'], ['other-admin', 'GLOBAL_ADMIN'], ['manager', 'PROPERTY_MANAGER'], ['target', 'CENTRE_STAFF']]) {
    const user = await prisma.user.create({ data: { id, username: id, email: `${id}@example.com`, name: id,
      role, passwordHash: 'fixture', authenticator: { create: { enrolledAt: new Date(), secretCiphertext: 'fixture' } },
      assignedProperties: { create: { propertyId: 'a' } },
    } });
    tokens[id] = signToken(user);
  }
});
test.after(() => database.dispose());

test('only global administrators can edit and delete users', async () => {
  for (const account of ['none', 'manager', 'target']) {
    assert.equal((await call('PUT', '/target', { name: 'Changed' }, account)).status, account === 'none' ? 401 : 403);
    assert.equal((await remove(account)).status, account === 'none' ? 401 : 403);
  }
  assert.equal((await prisma.user.findUnique({ where: { id: 'target' } })).name, 'target');
  assert.equal(await prisma.auditLog.count(), 0);
});

test('admin edits account details, role, status and assignments without exposing credentials', async () => {
  const result = await call('PUT', '/target', { username: ' New.Name ', name: ' New Name ', email: 'SHARED@example.com', role: 'PROPERTY_MANAGER', isActive: false, propertyIds: ['b'] });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.username, 'new.name'); assert.equal(result.body.user.name, 'New Name');
  assert.equal(result.body.user.email, 'shared@example.com'); assert.equal(result.body.user.role, 'PROPERTY_MANAGER');
  assert.equal(result.body.user.isActive, false);
  assert.deepEqual(result.body.user.assignedProperties.map(p => p.id), ['b']);
  assert(!JSON.stringify(result.body).includes('passwordHash'));
  assert(!JSON.stringify(result.body).includes('secretCiphertext'));
  assert.equal((await call('GET', '/', {}, 'target')).status, 401);
  assert.equal((await call('PUT', '/target', { isActive: true, email: '' })).status, 200);
  const updated = await prisma.user.findUnique({ where: { id: 'target' } });
  assert.equal(updated.email, null); assert.equal(updated.username, 'new.name');
  // Existing sessions use the current role and assignments from the database.
  assert.equal((await call('PUT', '/manager', { name: 'Forbidden' }, 'target')).status, 403);
  assert.equal(await prisma.auditLog.count({ where: { action: 'USER_UPDATE' } }), 2);
});

test('invalid edits and duplicate usernames never change an account or its assignments', async () => {
  const before = await prisma.user.findUnique({ where: { id: 'target' }, include: { assignedProperties: true } });
  for (const body of [{}, { name: ' ' }, { username: 'a' }, { email: 'invalid' }, { role: 'INVALID' }, { isActive: 'false' }, { password: 'Ignored?' }, { propertyIds: ['a', 'a'] }, { propertyIds: ['missing'] }, { propertyIds: ['inactive'] }, { propertyIds: ['removed'] }]) {
    assert.equal((await call('PUT', '/target', body)).status, 400, JSON.stringify(body));
  }
  for (const username of ['admin', 'admin@example.com']) assert.equal((await call('PUT', '/target', { username })).status, 409);
  assert.deepEqual(await prisma.user.findUnique({ where: { id: 'target' }, include: { assignedProperties: true } }), before);
  assert.equal(await prisma.auditLog.count(), 0);
  assert.equal((await call('PUT', '/missing', { name: 'Missing' })).status, 404);
});

test('editing preserves existing assignments to inactive properties but rejects new ones', async () => {
  await prisma.property.update({ where: { id: 'a' }, data: { isActive: false } });
  assert.equal((await call('PUT', '/target', { name: 'Updated', propertyIds: ['a'] })).status, 200);
  assert.equal((await call('PUT', '/target', { propertyIds: ['inactive'] })).status, 400);
  assert.equal((await call('PUT', '/target', { propertyIds: [] })).status, 200);
  assert.equal(await prisma.userProperty.count({ where: { userId: 'target' } }), 0);
});

test('self deletion, disabling and demotion are rejected while profile edits remain available', async () => {
  assert.equal((await call('DELETE', '/admin', { confirmationUsername: 'admin' })).status, 400);
  assert.equal((await call('PUT', '/admin', { isActive: false })).status, 400);
  assert.equal((await call('PUT', '/admin', { role: 'CENTRE_STAFF' })).status, 400);
  assert.equal((await call('PUT', '/admin', { name: 'Administrator' })).status, 200);
});

test('confirmed deletion revokes existing access and recovery while retaining historical references', async () => {
  await prisma.staffMember.create({ data: { id: 'roster', userId: 'target', propertyId: 'a', name: 'Diver', roleTitle: 'Instructor', hireDate: '2026-01-01' } });
  await prisma.bill.create({ data: { id: 'bill', propertyId: 'a', checkNumber: 1001, businessDate: '2026-10-28', guestName: 'Guest', roomNumber: '100', createdById: 'target' } });
  await prisma.monthLock.create({ data: { propertyId: 'a', yearMonth: '2026-09', lockedById: 'target' } });
  await prisma.auditLog.create({ data: { action: 'LOGIN_SUCCESS', userId: 'target', targetType: 'User', targetId: 'target' } });
  await prisma.passwordReset.create({ data: { userId: 'target', credentialHash: 'fixture', requestedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  assert.equal((await remove('admin', 'wrong')).status, 400);
  assert.equal((await call('DELETE', '/target')).status, 400);
  assert.equal((await remove('admin', ' TARGET ')).status, 200);
  const retained = await prisma.user.findUnique({ where: { id: 'target' } });
  assert(retained.deletedAt); assert.equal(retained.isActive, false);
  assert.equal((await call('GET', '/', {}, 'target')).status, 401);
  for (const account of ['admin', 'manager']) assert(!(await call('GET', '/', {}, account)).body.users.some(u => u.id === 'target'));
  assert.equal(await prisma.userProperty.count({ where: { userId: 'target' } }), 0);
  assert.equal(await prisma.authenticator.count({ where: { userId: 'target' } }), 0);
  assert.equal(await prisma.passwordReset.count({ where: { userId: 'target' } }), 0);
  assert.equal((await prisma.bill.findUnique({ where: { id: 'bill' } })).createdById, 'target');
  assert.equal((await prisma.staffMember.findUnique({ where: { id: 'roster' } })).userId, 'target');
  assert.equal(await prisma.monthLock.count({ where: { lockedById: 'target' } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { userId: 'target' } }), 1);
  assert.equal(JSON.parse((await prisma.auditLog.findFirst({ where: { action: 'USER_DELETE' } })).details).historyRetained, true);
  assert.equal((await call('PUT', '/target', { isActive: true })).status, 404);
  assert.equal((await call('POST', '/target/reset-password', { password: 'StrongPassword12!' })).status, 404);
  assert.equal((await call('POST', '/target/unlock')).status, 404);
  assert.equal((await remove()).status, 404);
  assert.equal((await call('PUT', '/manager', { username: 'target' })).status, 409);
});

test('concurrent administrators cannot delete or disable each other and leave no administrator', async () => {
  const results = await Promise.all([
    call('DELETE', '/other-admin', { confirmationUsername: 'other-admin' }),
    call('PUT', '/admin', { isActive: false }, 'other-admin'),
  ]);
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(await prisma.user.count({ where: { role: 'GLOBAL_ADMIN', isActive: true, deletedAt: null } }), 1);
});

test('audit failure rolls back edits, deletion and assignment changes', async () => {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_user_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('USER_UPDATE', 'USER_DELETE') THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_user_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_user_audit()`);
  try {
    assert.equal((await call('PUT', '/target', { name: 'Changed', propertyIds: ['b'] })).status, 500);
    assert.equal((await remove()).status, 500);
    const target = await prisma.user.findUnique({ where: { id: 'target' }, include: { assignedProperties: true, authenticator: true } });
    assert.equal(target.name, 'target'); assert.equal(target.isActive, true); assert.equal(target.deletedAt, null);
    assert.deepEqual(target.assignedProperties.map(p => p.propertyId), ['a']); assert(target.authenticator);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_user_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION reject_user_audit()');
  }
});


test('partial account edits preserve omitted contact and assignment fields after validator upgrade', async () => {
  const before = await prisma.user.findUnique({ where: { id: 'target' } });
  assert.equal((await call('PUT', '/target', { name: 'New Display Name' })).status, 200);
  const after = await prisma.user.findUnique({ where: { id: 'target' } });
  for (const key of ['email', 'username', 'role', 'isActive', 'passwordHash']) assert.equal(after[key], before[key]);
  assert.deepEqual((await prisma.userProperty.findMany({ where: { userId: 'target' } })).map(p => p.propertyId), ['a']);
});
