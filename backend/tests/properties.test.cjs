const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const testDatabase = createTestDatabase('properties');
const prisma = testDatabase.prisma;
process.env.JWT_SECRET = randomBytes(48).toString('hex'); delete process.env.JWT_SECRET_FILE;
const stubs = { '../db': { prisma } };
const auth = loadTypeScript('src/middleware/auth.ts', stubs);
const { propertiesRouter } = loadTypeScript('src/routes/properties.routes.ts', stubs);
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const { staffRouter } = loadTypeScript('src/routes/staff.routes.ts', stubs);
const { usersRouter } = loadTypeScript('src/routes/users.routes.ts', stubs);
const tokens = {};
const call = (method, url, body = {}, role = 'admin', router = propertiesRouter, query = {}) => request(router, method, url, { user: null, body, query, headers: tokens[role] ? { authorization: `Bearer ${tokens[role]}` } : {} });
const remove = (body = { confirmationCode: 'ARCH' }, role = 'admin') => call('DELETE', '/archive', body, role);

test.beforeEach(async () => {
  await prisma.auditLog.deleteMany(); await prisma.billItem.deleteMany(); await prisma.bill.deleteMany();
  await prisma.attendance.deleteMany(); await prisma.monthLock.deleteMany(); await prisma.item.deleteMany(); await prisma.category.deleteMany();
  await prisma.staffMember.deleteMany(); await prisma.userProperty.deleteMany(); await prisma.property.deleteMany(); await prisma.user.deleteMany();
  await prisma.property.createMany({ data: [{ id: 'archive', name: 'Archive Test', code: 'ARCH' }, { id: 'other', name: 'Other Centre', code: 'OTHER' }] });
  for (const [id, role] of [['admin', 'GLOBAL_ADMIN'], ['manager', 'PROPERTY_MANAGER'], ['staff', 'CENTRE_STAFF']]) {
    const user = await prisma.user.create({ data: { id, username: id, name: id, passwordHash: 'fixture-hash', role, authenticator: { create: { enrolledAt: new Date(), secretCiphertext: 'fixture' } }, assignedProperties: id === 'admin' ? undefined : { create: [{ propertyId: 'archive' }, { propertyId: 'other' }] } } });
    tokens[id] = auth.signToken(user);
  }
  for (const id of ['archive', 'other']) {
    await prisma.staffMember.create({ data: { id: `staff-${id}`, propertyId: id, name: 'Historical Staff', roleTitle: 'Instructor', hireDate: '2026-01-01' } });
    await prisma.category.create({ data: { id: `cat-${id}`, propertyId: id, name: 'Dives' } });
    await prisma.item.create({ data: { id: `item-${id}`, propertyId: id, categoryId: `cat-${id}`, code: 'DIVE', name: 'Dive', price: 50 } });
    await prisma.bill.create({ data: { id: `bill-${id}`, propertyId: id, checkNumber: 1001, businessDate: '2026-10-20', guestName: 'Historical Guest', roomNumber: '104', createdById: 'admin', items: { create: { itemId: `item-${id}`, itemName: 'Dive', categoryName: 'Dives', quantity: 1, unitPrice: 50, lineTotal: 50, sellerStaffId: `staff-${id}` } } } });
    await prisma.attendance.create({ data: { propertyId: id, staffMemberId: `staff-${id}`, date: '2026-10-20', status: 'PRESENT' } });
    await prisma.monthLock.create({ data: { propertyId: id, yearMonth: '2026-09', lockedById: 'admin' } });
  }
});
test.after(async () => { await testDatabase.dispose(); });

test('creation and deletion are global-admin only, including managers assigned to the property', async () => {
  for (const role of ['none', 'manager', 'staff']) {
    const expected = role === 'none' ? 401 : 403;
    assert.equal((await call('POST', '/', { name: 'New Centre', code: 'NEW' }, role)).status, expected);
    assert.equal((await remove({ confirmationCode: 'ARCH' }, role)).status, expected);
  }
  assert.equal(await prisma.property.count(), 2);
  assert.equal(await prisma.auditLog.count(), 0);
});
test('global admin creates a property with standard categories, validated inputs, normalized code and audit entry', async () => {
  const result = await call('POST', '/', { name: '  New Centre  ', code: ' new ', pmsPropertyCode: 'OLHU' });
  assert.equal(result.status, 201); assert.equal(result.body.property.name, 'New Centre'); assert.equal(result.body.property.code, 'NEW');
  assert.equal(await prisma.category.count({ where: { propertyId: result.body.property.id } }), 5);
  assert.equal((await prisma.auditLog.findFirst({ where: { action: 'PROPERTY_CREATE' } })).userId, 'admin');
  assert.equal((await call('POST', '/', { name: 'Duplicate', code: 'new' })).status, 409);
  assert.equal((await call('POST', '/', { name: '   ', code: 'BAD' })).status, 400);
});
test('invalid property codes return actionable errors without creating a property or audit entry', async () => {
  for (const code of ['A', ' A ', 'ABCDEFGHIJK']) {
    const result = await call('POST', '/', { name: 'New Centre', code });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Property code/);
    assert.deepEqual(result.body.details[0].path, ['code']);
  }
  assert.equal(await prisma.property.count(), 2);
  assert.equal(await prisma.auditLog.count(), 0);
});
test('the name-only form generates unique codes for omitted, empty and whitespace codes', async () => {
  const codes = [];
  for (const code of [undefined, '', '   ']) {
    const result = await call('POST', '/', { name: 'Villu Reef', code, pmsPropertyCodes: ['VILU'] });
    assert.equal(result.status, 201);
    assert.match(result.body.property.code, /^[A-Z0-9-]{2,10}$/);
    assert.deepEqual(result.body.property.pmsPropertyCodes, ['VILU']);
    codes.push(result.body.property.code);
    assert.equal(await prisma.category.count({ where: { propertyId: result.body.property.id } }), 5);
  }
  assert.equal(codes[0], 'VILLU-REEF');
  assert.equal(new Set(codes).size, 3);
  assert.equal(await prisma.auditLog.count({ where: { action: 'PROPERTY_CREATE' } }), 3);
});
test('generated property codes do not reuse retained historical codes', async () => {
  await remove();
  const result = await call('POST', '/', { name: 'Arch' });
  assert.equal(result.status, 201);
  assert.notEqual(result.body.property.code, 'ARCH');
});
test('deletion requires the matching property code and handles unknown or already removed properties', async () => {
  for (const body of [{}, { confirmationCode: 'wrong' }, { confirmationCode: ['ARCH'] }]) assert.equal((await remove(body)).status, 400);
  assert.equal((await prisma.property.findUnique({ where: { id: 'archive' } })).deletedAt, null);
  assert.equal((await call('DELETE', '/missing', { confirmationCode: 'ARCH' })).status, 404);
  assert.equal((await remove()).status, 200);
  assert.equal((await remove()).status, 404);
});
test('deletion removes the property from every workspace list while preserving business and payroll history', async () => {
  const before = await Promise.all([prisma.bill.findMany(), prisma.billItem.findMany(), prisma.staffMember.findMany(), prisma.item.findMany(), prisma.category.findMany(), prisma.attendance.findMany(), prisma.monthLock.findMany(), prisma.user.count()]);
  assert.equal((await remove()).status, 200);
  const property = await prisma.property.findUnique({ where: { id: 'archive' } });
  assert.ok(property.deletedAt); assert.equal(property.isActive, false);
  const after = await Promise.all([prisma.bill.findMany(), prisma.billItem.findMany(), prisma.staffMember.findMany(), prisma.item.findMany(), prisma.category.findMany(), prisma.attendance.findMany(), prisma.monthLock.findMany(), prisma.user.count()]);
  assert.deepEqual(after, before);
  for (const role of ['admin', 'manager', 'staff']) assert.deepEqual((await call('GET', '/', {}, role)).body.properties.map(p => p.id), ['other']);
  assert.equal(await prisma.userProperty.count({ where: { propertyId: 'archive' } }), 0);
  assert.equal(await prisma.userProperty.count({ where: { propertyId: 'other' } }), 2);
  const audit = await prisma.auditLog.findFirst({ where: { action: 'PROPERTY_DELETE' } });
  assert.equal(audit.userId, 'admin'); assert.equal(audit.propertyId, 'archive');
  assert.equal(JSON.parse(audit.details).historyRetained, true);
  assert.equal((await prisma.property.findUnique({ where: { id: 'other' } })).deletedAt, null);
});
test('old sessions lose deleted property access and even global admins cannot modify the retained history', async () => {
  assert.equal((await remove()).status, 200);
  for (const role of ['manager', 'staff']) assert.equal((await call('GET', '/bill-archive', {}, role, billsRouter)).status, 403);
  assert.equal((await call('POST', '/', { propertyId: 'archive' }, 'admin', billsRouter)).status, 410);
  assert.equal((await call('POST', '/bill-archive/re-date', { newDate: '2026-10-21' }, 'admin', billsRouter)).status, 410);
  assert.equal((await call('POST', '/bill-archive/rebate', { reason: 'Try changing retained history' }, 'admin', billsRouter)).status, 410);
  assert.equal((await call('DELETE', '/bill-archive', {}, 'admin', billsRouter)).status, 410);
  assert.equal((await call('PUT', '/item-archive', { name: 'Changed' }, 'admin', itemsRouter)).status, 410);
  assert.equal((await call('PUT', '/staff-archive', { name: 'Changed' }, 'admin', staffRouter)).status, 410);
  assert.equal((await call('PUT', '/archive', { isActive: true })).status, 410);
  assert.equal((await call('PUT', '/staff', { propertyIds: ['archive'] }, 'admin', usersRouter)).status, 400);
  assert.equal((await call('GET', '/bill-archive', {}, 'admin', billsRouter)).status, 200);
});
test('the code of a removed property remains reserved to avoid mixing historical records with a new centre', async () => {
  await remove();
  assert.equal((await call('POST', '/', { name: 'New Centre', code: 'arch' })).status, 409);
});
test('audit failure rolls back property removal and assignment revocation together', async () => {
  const failing = { $transaction: callback => prisma.$transaction(tx => callback({ property: tx.property, userProperty: tx.userProperty, auditLog: { create: async () => { throw Error('Private failure'); } } })) };
  const { propertiesRouter: router } = loadTypeScript('src/routes/properties.routes.ts', { '../db': { prisma: failing }, '../middleware/auth': { requireAuth: (req, res, next) => next() } });
  const result = await request(router, 'DELETE', '/archive', { user: { id: 'admin', role: 'GLOBAL_ADMIN' }, body: { confirmationCode: 'ARCH' } });
  assert.equal(result.status, 500); assert.equal(JSON.stringify(result.body).includes('Private failure'), false);
  assert.equal((await prisma.property.findUnique({ where: { id: 'archive' } })).deletedAt, null);
  assert.equal(await prisma.userProperty.count({ where: { propertyId: 'archive' } }), 2);
});

test('global admin edits existing property details and keeps business history and assignments', async () => {
  const result = await call('PUT', '/archive', {
    name: '  Updated Centre  ', code: ' edited ', location: 'Baa Atoll',
    currency: 'EUR', currencySymbol: '€', taxRate: 12.5, serviceChargeRate: 8,
    nextCheckNumber: 2001, isActive: false, pmsPropertyCodes: ['OLHU'],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.property.name, 'Updated Centre');
  assert.equal(result.body.property.code, 'EDITED');
  assert.equal(result.body.property.location, 'Baa Atoll');
  assert.equal(result.body.property.currency, 'EUR');
  assert.equal(result.body.property.currencySymbol, '€');
  assert.equal(result.body.property.taxRate, 12.5);
  assert.equal(result.body.property.serviceChargeRate, 8);
  assert.equal(result.body.property.nextCheckNumber, 2001);
  assert.equal(result.body.property.isActive, false);
  assert.deepEqual(result.body.property.pmsPropertyCodes, ['OLHU']);
  assert.equal(await prisma.bill.count({ where: { propertyId: 'archive' } }), 1);
  assert.equal(await prisma.userProperty.count({ where: { propertyId: 'archive' } }), 2);
  const audit = await prisma.auditLog.findFirst({ where: { action: 'PROPERTY_UPDATE' } });
  assert.equal(audit.userId, 'admin');
  assert.equal(JSON.parse(audit.details).code, 'EDITED');
  assert.equal((await call('PUT', '/archive', { isActive: true })).status, 200);
});

test('partial property updates preserve omitted fields and reject invalid input without writes', async () => {
  await prisma.property.update({ where: { id: 'archive' }, data: { currency: 'EUR', currencySymbol: '€', taxRate: 12.5, serviceChargeRate: 8, nextCheckNumber: 3000, pmsPropertyCode: 'OLHU', pmsPropertyCodes: ['OLHU'] } });
  const before = await prisma.property.findUnique({ where: { id: 'archive' } });
  for (const body of [{ name: ' ' }, { code: '' }, { code: 'ABCDEFGHIJK' }, { taxRate: -1 }, { taxRate: 101 }, { serviceChargeRate: 101 }, { nextCheckNumber: 0 }, { nextCheckNumber: 1.5 }, { isActive: 'false' }, { currency: ' ' }, { currencySymbol: '' }]) {
    assert.equal((await call('PUT', '/archive', body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(await prisma.property.findUnique({ where: { id: 'archive' } }), before);
  assert.equal(await prisma.auditLog.count(), 0);
  const result = await call('PUT', '/archive', { name: 'Renamed Centre' });
  assert.equal(result.status, 200);
  for (const key of ['code', 'taxRate', 'serviceChargeRate', 'nextCheckNumber', 'currency', 'isActive', 'pmsPropertyCode', 'pmsPropertyCodes']) assert.deepEqual(result.body.property[key], before[key]);
});

test('property code edits reserve historical codes and require global administrator access', async () => {
  assert.equal((await call('PUT', '/archive', { code: 'other' })).status, 409);
  for (const role of ['none', 'manager', 'staff']) {
    assert.equal((await call('PUT', '/archive', { code: 'EDITED' }, role)).status, role === 'none' ? 401 : 403);
  }
  assert.equal((await call('PUT', '/archive', { name: 'Forbidden' }, 'staff')).status, 403);
  await prisma.userProperty.deleteMany({ where: { userId: 'manager', propertyId: 'archive' } });
  assert.equal((await call('PUT', '/archive', { name: 'Forbidden' }, 'manager')).status, 403);
  assert.equal((await call('PUT', '/missing', { name: 'Missing' })).status, 404);
  await remove();
  assert.equal((await call('PUT', '/other', { code: 'ARCH' })).status, 409);
  assert.equal((await call('PUT', '/archive', { name: 'Removed' })).status, 410);
});
