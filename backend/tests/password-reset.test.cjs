const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');

function fixture(managedProperties = ['male']) {
  const accounts = [
    { id: 'own', role: 'CENTRE_STAFF', properties: ['male'] },
    { id: 'other', role: 'CENTRE_STAFF', properties: ['ari'] },
    { id: 'shared', role: 'CENTRE_STAFF', properties: ['male', 'ari'] },
    { id: 'unassigned', role: 'CENTRE_STAFF', properties: [] },
    { id: 'manager', role: 'PROPERTY_MANAGER', properties: managedProperties },
    { id: 'admin', role: 'GLOBAL_ADMIN', properties: [] },
  ].map(account => ({ ...account, passwordHash: 'fixture', mustChangePassword: false, isActive: true, deletedAt: null, name: account.id, email: `${account.id}@example.test`, assignedProperties: account.properties.map(propertyId => ({ propertyId, property: { id: propertyId, name: propertyId } })) }));
  const writes = [], audit = [], listQueries = [];
  const prisma = { user: {
    findUnique: async ({ where }) => accounts.find(account => account.id === where.id) || null,
    findMany: async ({ where, select }) => {
      listQueries.push({ where, select });
      return accounts.filter(account => !where.role || account.role === where.role && account.properties.some(id => where.assignedProperties.some.propertyId.in.includes(id)) && account.properties.every(id => where.assignedProperties.every.propertyId.in.includes(id)));
    },
    update: async args => { writes.push(args); return {}; },
  }, auditLog: { create: async ({ data }) => { audit.push(data); return data; } } };
  prisma.$transaction = operation => operation(prisma);
  const { usersRouter } = loadTypeScript('src/routes/users.routes.ts', {
    '../db': { prisma },
    '../middleware/auth': { requireAuth: (req, res, next) => { req.authenticatedPasswordHash = 'fixture'; return req.user ? next() : res.status(401).json({ error: 'Authentication required' }); } },
    '../services/auditService': { logAuditEvent: async ({ req, ...event }) => audit.push(event) },
  });
  return { router: usersRouter, writes, audit, listQueries };
}
const manager = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['male'] };
const admin = { id: 'admin', role: 'GLOBAL_ADMIN', assignedPropertyIds: [] };
const reset = (fixture, id, user = manager, password = 'NewPass1!abc') => request(fixture.router, 'POST', `/${id}/reset-password`, { user, body: { password }, headers: { 'x-property-id': 'male' } });

test('manager can reset their staff password, hash it, clear lockout, and audit without exposing the password', async () => {
  const f = fixture();
  const result = await reset(f, 'own');
  assert.equal(result.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].where.id, 'own');
  assert.equal(await bcrypt.compare('NewPass1!abc', f.writes[0].data.passwordHash), true);
  assert.equal(f.writes[0].data.mustChangePassword, true);
  assert.equal(f.writes[0].data.failedLoginAttempts, 0);
  assert.equal(f.writes[0].data.lockedUntil, null);
  assert.equal(f.audit[0].userId, 'manager');
  assert.equal(f.audit[0].targetId, 'own');
  assert.equal(f.audit[0].propertyId, 'male');
  assert.equal(f.audit[0].action, 'PASSWORD_RESET');
  assert.equal(JSON.stringify([result.body, f.audit]).includes('NewPass1!abc'), false);
});
test('manager cannot reset other properties, shared accounts, unassigned staff, managers, or administrators', async () => {
  const f = fixture();
  for (const id of ['other', 'shared', 'unassigned', 'manager', 'admin']) assert.equal((await reset(f, id)).status, 403, id);
  assert.equal(f.writes.length, 0);
  assert.equal(f.audit.length, 0);
});
test('manager of all staff assignments can reset a shared staff account', async () => {
  assert.equal((await reset(fixture(['male', 'ari']), 'shared', { ...manager, assignedPropertyIds: ['male', 'ari'] })).status, 200);
});
test('staff and unauthenticated callers cannot reset passwords', async () => {
  const f = fixture();
  assert.equal((await reset(f, 'own', { ...manager, role: 'CENTRE_STAFF' })).status, 403);
  assert.equal((await reset(f, 'own', null)).status, 401);
  assert.equal(f.writes.length, 0);
});
test('global administrator retains reset access across roles and properties', async () => {
  const f = fixture();
  assert.equal((await reset(f, 'other', admin)).status, 200);
  assert.equal((await reset(f, 'manager', admin)).status, 200);
});
test('unknown accounts and invalid password types or lengths cause no writes', async () => {
  const f = fixture();
  assert.equal((await reset(f, 'missing')).status, 404);
  for (const password of ['', 'short', 123456, { length: 10 }, null]) assert.equal((await reset(f, 'own', manager, password)).status, 400);
  assert.equal(f.writes.length, 0);
});
test('manager account list contains only resettable staff and returns normalized property labels', async () => {
  const f = fixture();
  const result = await request(f.router, 'GET', '/', { user: manager });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.users.map(user => user.id), ['own']);
  assert.deepEqual(result.body.users[0].assignedProperties, [{ id: 'male', name: 'male' }]);
  assert.equal(f.listQueries[0].select.passwordHash, undefined);
  const empty = await request(f.router, 'GET', '/', { user: { ...manager, assignedPropertyIds: [] } });
  assert.deepEqual(empty.body.users, []);
});
test('global administrators can still list all users, while staff cannot list accounts', async () => {
  const f = fixture();
  assert.equal((await request(f.router, 'GET', '/', { user: admin })).body.users.length, 6);
  assert.equal((await request(f.router, 'GET', '/', { user: { ...manager, role: 'CENTRE_STAFF' } })).status, 403);
});
test('managers cannot change roles or use standalone unlock permissions', async () => {
  const f = fixture();
  for (const [method, url] of [['PUT', '/own'], ['POST', '/own/unlock']]) {
    assert.equal((await request(f.router, method, url, { user: manager, body: { role: 'GLOBAL_ADMIN' } })).status, 403);
  }
  assert.equal(f.writes.length, 0);
});
