const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('roletitles');
const { prisma } = database;
const manager = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const admin = { ...manager, role: 'GLOBAL_ADMIN' };
const { staffRouter } = loadTypeScript('src/routes/staff.routes.ts', {
  '../db': { prisma },
  '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) },
});
const create = (name, propertyId = 'a', user = manager) => request(staffRouter, 'POST', '/role-titles', { body: { name, propertyId }, user });
const list = (propertyId = 'a', user = manager) => request(staffRouter, 'GET', '/role-titles', { query: { propertyId }, user });
test.before(async () => {
  await prisma.property.createMany({ data: [
    { id: 'a', code: 'A', name: 'Centre A' }, { id: 'b', code: 'B', name: 'Centre B' },
    { id: 'inactive', code: 'I', name: 'Inactive', isActive: false },
    { id: 'deleted', code: 'D', name: 'Removed', deletedAt: new Date() },
  ] });
  await prisma.user.create({ data: { id: 'manager', username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
});
test.after(() => database.dispose());
test('creation requires account-manager permissions and property access', async () => {
  assert.equal((await create('Denied', 'a', null)).status, 401);
  assert.equal((await create('Denied', 'a', { ...manager, role: 'CENTRE_STAFF' })).status, 403);
  assert.equal((await create('Denied', 'b')).status, 403);
  assert.equal((await list('b')).status, 403);
  assert.equal(await prisma.staffRoleTitle.count(), 0);
});
test('manager saves normalized property titles, persists without staff, and audits creation', async () => {
  const result = await create('  Marine   Biologist  ');
  assert.equal(result.status, 201);
  assert.equal(result.body.roleTitle, 'Marine Biologist');
  assert((await list()).body.roleTitles.includes('Marine Biologist'));
  assert((await list()).body.roleTitles.includes('Instructor'));
  assert(!(await list('b', admin)).body.roleTitles.includes('Marine Biologist'));
  const audit = await prisma.auditLog.findFirst({ where: { action: 'STAFF_ROLE_TITLE_CREATE' } });
  assert.equal(audit.propertyId, 'a');
  assert.equal((await create('Marine Biologist', 'b', admin)).status, 201);
});
test('blank, short, overlong, duplicate and inactive-property titles are rejected', async () => {
  for (const name of ['', '   ', 'x', 'x'.repeat(101), null, 123]) assert.equal((await create(name)).status, 400);
  assert.equal((await create(' instructor ')).status, 409);
  assert.equal((await create('marine biologist')).status, 409);
  for (const propertyId of ['missing', 'inactive', 'deleted']) assert.equal((await create('New Role', propertyId, admin)).status, 400);
});
test('simultaneous duplicates produce a single saved role title', async () => {
  const results = await Promise.all([create('Safety Officer'), create('SAFETY OFFICER')]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(await prisma.staffRoleTitle.count({ where: { propertyId: 'a', normalizedName: 'safety officer' } }), 1);
});
test('custom titles work for staff and legacy titles stay available', async () => {
  const result = await request(staffRouter, 'POST', '/', { body: { propertyId: 'a', name: 'Custom staff', roleTitle: '  Marine Biologist ', hireDate: '2026-01-01' }, user: manager });
  assert.equal(result.status, 201);
  assert.equal(result.body.staff.roleTitle, 'Marine Biologist');
  await prisma.staffMember.create({ data: { propertyId: 'a', name: 'Legacy staff', roleTitle: 'Legacy Specialist', hireDate: '2026-01-01' } });
  assert((await list()).body.roleTitles.includes('Legacy Specialist'));
  assert.equal((await request(staffRouter, 'PUT', `/${result.body.staff.id}`, { body: { roleTitle: '  ' }, user: manager })).status, 400);
});
