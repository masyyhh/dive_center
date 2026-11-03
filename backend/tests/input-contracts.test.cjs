const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('inputcontracts');
const { prisma } = database;
const user = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => next() }, 'express-rate-limit': () => (req, res, next) => next() };
const { staffRouter } = loadTypeScript('src/routes/staff.routes.ts', stubs);
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { reportsRouter } = loadTypeScript('src/routes/reports.routes.ts', stubs);
const { waterSportsRouter } = loadTypeScript('src/routes/water-sports.routes.ts', stubs);
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const { propertiesRouter } = loadTypeScript('src/routes/properties.routes.ts', stubs);
const { auditRouter } = loadTypeScript('src/routes/audit.routes.ts', stubs);
const { roomNumberSchema, positiveIntSchema } = loadTypeScript('src/utils/fields.ts');
const call = (router, method, url, body = {}, query = {}, actor = user) => request({ handle(req, res, next) { res.setHeader = () => {}; router.handle(req, res, next); } }, method, url, { body, query, user: actor });
const bill = { propertyId: 'a', checkNumber: 1, businessDate: '2026-11-01', guestName: 'Guest', roomNumber: '0012', items: [{ itemId: 'activity', itemName: 'Dive', categoryName: 'Dives', quantity: 1, unitPrice: 100 }] };
test.before(async () => {
  await prisma.property.create({ data: { id: 'a', name: 'Centre', code: 'A' } });
  await prisma.user.create({ data: { id: user.id, username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
  await prisma.staffMember.create({ data: { id: 'employee', propertyId: 'a', name: 'Employee', roleTitle: 'Guide', hireDate: '2026-01-01' } });
  await prisma.category.create({ data: { id: 'category', propertyId: 'a', name: 'Dives' } });
  await prisma.item.create({ data: { id: 'activity', propertyId: 'a', categoryId: 'category', code: 'DIV-001', name: 'Dive', price: 100 } });
});
test.after(() => database.dispose());
test('room identifiers accept digits and preserve zeros; numbers and malformed strings fail', () => {
  assert.equal(roomNumberSchema.parse(' 0012 '), '0012');
  for (const value of [12, true, null, {}, ['12'], '', 'A101', '12-3', '12.3', '1e2', '12 3', '١٢', '1'.repeat(33)]) assert.equal(roomNumberSchema.safeParse(value).success, false, JSON.stringify(value));
  for (const value of ['12', true, null, 0, -1, 1.5, 2147483648, NaN, Infinity]) assert.equal(positiveIntSchema.safeParse(value).success, false);
});
test('staff updates reject wrong booleans, invalid dates and blank names without mutations', async () => {
  const before = await prisma.staffMember.findUnique({ where: { id: 'employee' } });
  for (const field of ['isActive', 'isDiveStaff', 'isCoursePoolSharing', 'isDivePoolSharing', 'isBaseLeaderOverride']) {
    for (const value of ['false', 'true', 0, 1, null, []]) assert.equal((await call(staffRouter, 'PUT', '/employee', { [field]: value })).status, 400);
  }
  for (const body of [{ name: '  ' }, { name: 1 }, { email: 3 }, { hireDate: '2026-02-30' }, { leavingDate: '2025-01-01' }, { hireDate: null }, { unknown: 1 }, {}]) assert.equal((await call(staffRouter, 'PUT', '/employee', body)).status, 400, JSON.stringify(body));
  assert.deepEqual(await prisma.staffMember.findUnique({ where: { id: 'employee' } }), before);
  assert.equal((await call(staffRouter, 'PUT', '/employee', { isDiveStaff: false })).status, 200);
  assert.equal((await prisma.staffMember.findUnique({ where: { id: 'employee' } })).isDiveStaff, false);
  assert.equal((await call(staffRouter, 'PUT', '/employee', { name: 'Renamed employee' })).status, 200);
  assert.equal((await prisma.staffMember.findUnique({ where: { id: 'employee' } })).isDiveStaff, false, 'Unrelated edits must preserve omitted booleans');
});
test('billing rejects invalid room, date and numeric types, preserving leading zeros on valid save', async () => {
  for (const body of [{ roomNumber: 'A101' }, { roomNumber: 101 }, { roomNumber: ['101'] }, { guestName: '  ' }, { checkNumber: '1' }, { checkNumber: 2147483648 }, { departureDate: '2026-02-30' }, { tipAmount: '5' }]) assert.equal((await call(billsRouter, 'POST', '/', { ...bill, ...body })).status, 400, JSON.stringify(body));
  assert.equal(await prisma.bill.count(), 0);
  const oversized = await call(billsRouter, 'POST', '/', { ...bill, items: [{ ...bill.items[0], unitPrice: 1e308, quantity: 2 }] });
  assert.equal(oversized.status, 400);
  const saved = await call(billsRouter, 'POST', '/', bill);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.bill.roomNumber, '0012');
  assert.equal((await call(billsRouter, 'GET', '/room-lookup', {}, { propertyId: 'a', roomNumber: ['101'] })).status, 400);
});
test('Dive Centre and payroll locking reject invalid types before writing', async () => {
  for (const roomNumber of ['A101', 101, ['101']]) assert.equal((await call(waterSportsRouter, 'POST', '/sessions', { propertyId: 'a', formType: 'SNORKELING', roomNumber, staffFields: {} })).status, 400);
  for (const lock of ['false', 0, 1, null, []]) assert.equal((await call(reportsRouter, 'POST', '/month-lock', { propertyId: 'a', yearMonth: '2026-11', lock })).status, 400);
  assert.equal(await prisma.waterSportsSession.count(), 0);
  assert.equal(await prisma.monthLock.count(), 0);
});
test('query and database integer inputs reject partial numbers and arrays for all roles', async () => {
  for (const actor of [user, { ...user, role: 'GLOBAL_ADMIN' }]) {
    assert.equal((await call(itemsRouter, 'GET', '/', {}, { propertyId: ['a'] }, actor)).status, 400);
    for (const limit of ['10oops', '-1', '501', ['10']]) assert.equal((await call(auditRouter, 'GET', '/', {}, { propertyId: 'a', limit }, actor)).status, 400);
  }
  assert.equal((await call(auditRouter, 'GET', '/', {}, {}, { ...user, role: 'GLOBAL_ADMIN' })).status, 200);
  assert.equal((await call(propertiesRouter, 'PUT', '/a', { nextCheckNumber: 2147483648 }, {}, { ...user, role: 'GLOBAL_ADMIN' })).status, 400);
  assert.equal((await call(staffRouter, 'GET', '/', {}, { propertyId: 'a', activeOnDate: '2026-02-30' })).status, 400);
  assert.equal((await call(staffRouter, 'GET', '/', {}, { propertyId: 'a', diveStaffOnly: 'yes' })).status, 400);
});

test('removed properties retain history and reject new bills and categories', async () => {
  await prisma.property.update({ where: { id: 'a' }, data: { deletedAt: new Date(), isActive: false } });
  const admin = { ...user, role: 'GLOBAL_ADMIN' };
  assert.equal((await call(billsRouter, 'POST', '/', { ...bill, checkNumber: 2 }, {}, admin)).status, 410);
  assert.equal((await call(itemsRouter, 'POST', '/categories', { propertyId: 'a', name: 'New category' }, {}, admin)).status, 410);
  assert.equal(await prisma.bill.count(), 1);
  assert.equal(await prisma.category.count(), 1);
});
