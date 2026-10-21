const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('staffcreditaudit');
const prisma = database.prisma;
const admin = { id: 'admin', role: 'GLOBAL_ADMIN', assignedPropertyIds: [] };
const manager = { ...admin, role: 'PROPERTY_MANAGER', assignedPropertyIds: ['male'] };
const auth = { requireAuth: (_req, _res, next) => next(), requireAccountAuth: (_req, _res, next) => next() };
const stubs = { '../db': { prisma }, '../middleware/auth': auth, '../services/auditService': { logAuditEvent: async () => {} } };
const { staffRouter } = loadTypeScript('src/routes/staff.routes.ts', stubs);
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { auditRouter } = loadTypeScript('src/routes/audit.routes.ts', stubs);
const { calculateCommissionForPeriod } = loadTypeScript('src/services/commissionService.ts', { '../db': { prisma } });
const statuses = ['PRESENT', 'OFF', 'OFF_HALF', 'ANNUAL_LEAVE', 'SICK', 'ABSENT', 'EMERGENCY_LEAVE'];
const date = '2026-10-21';
const call = (router, method, url, data = {}) => request(router, method, url, { user: admin, ...data });
let number = 100;
const bill = (id, role = 'seller') => ({ propertyId: 'male', checkNumber: number++, businessDate: date, guestName: 'Guest', roomNumber: '101', tipAmount: 12, tipStaffIds: [id], items: [{ itemId: 'dive', itemName: 'Dive', categoryName: 'Dives', quantity: 1, unitPrice: 100, [`${role}StaffId`]: id }] });
test.before(async () => {
  await prisma.property.createMany({ data: [{ id: 'male', code: 'MLE', name: 'Male' }, { id: 'other', code: 'OTH', name: 'Other' }] });
  await prisma.user.create({ data: { id: 'admin', username: 'admin', name: 'Admin', role: 'GLOBAL_ADMIN', passwordHash: 'fixture' } });
  await prisma.category.create({ data: { id: 'dives', propertyId: 'male', name: 'Dives' } });
  await prisma.item.create({ data: { id: 'dive', propertyId: 'male', categoryId: 'dives', code: 'DIVE', name: 'Dive', price: 100, personalRatesJson: JSON.stringify({ seller: 5, guide: 5, instructor: 5, photo: 5, video: 5 }), poolType: 'DIVE_POOL', poolContribution: 7 } });
  for (const status of [...statuses, 'UNRECORDED', 'FUTURE', 'FORMER']) {
    await prisma.staffMember.create({ data: { id: status, propertyId: 'male', name: status, roleTitle: 'Instructor', hireDate: status === 'FUTURE' ? '2026-11-01' : '2026-01-01', leavingDate: status === 'FORMER' ? '2026-09-30' : null } });
    if (statuses.includes(status)) await prisma.attendance.create({ data: { propertyId: 'male', staffMemberId: status, date, status } });
  }
});
test.after(async () => database.dispose());

test('bill choices exclude saved leave/absence and staff outside employment dates', async () => {
  const result = await call(staffRouter, 'GET', '/', { query: { propertyId: 'male', creditOnDate: date } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.staff.map(s => s.id).sort(), ['PRESENT', 'OFF', 'OFF_HALF', 'UNRECORDED'].sort());
  const roster = await call(staffRouter, 'GET', '/', { query: { propertyId: 'male' } });
  assert.equal(roster.body.staff.length, 10);
  assert.equal((await call(staffRouter, 'GET', '/', { query: { propertyId: 'male', creditOnDate: '2026-02-30' } })).status, 400);
});
test('server rejects every excluded status in all five credit roles and tip sharing', async () => {
  for (const status of statuses.slice(3)) {
    for (const role of ['seller', 'guide', 'instructor', 'photo', 'video']) {
      const payload = bill(status, role);
      payload.tipStaffIds = [];
      assert.equal((await call(billsRouter, 'POST', '/', { body: payload })).status, 400, `${status}: ${role}`);
    }
    const payload = bill(status);
    payload.items[0].sellerStaffId = null;
    assert.equal((await call(billsRouter, 'POST', '/', { body: payload })).status, 400, `${status}: tips`);
  }
  assert.equal(await prisma.bill.count(), 0);
});
test('included and unrecorded staff remain selectable; re-dates check the target attendance', async () => {
  for (const status of ['PRESENT', 'OFF', 'OFF_HALF', 'UNRECORDED']) assert.equal((await call(billsRouter, 'POST', '/', { body: bill(status) })).status, 201);
  for (const status of ['FUTURE', 'FORMER']) assert.equal((await call(billsRouter, 'POST', '/', { body: bill(status) })).status, 400);
  const saved = await prisma.bill.findFirst({ where: { items: { some: { sellerStaffId: 'PRESENT' } } } });
  await prisma.attendance.create({ data: { propertyId: 'male', staffMemberId: 'PRESENT', date: '2026-10-22', status: 'SICK' } });
  assert.equal((await call(billsRouter, 'POST', `/${saved.id}/re-date`, { body: { newDate: '2026-10-22' } })).status, 400);
  assert.equal((await prisma.bill.findUnique({ where: { id: saved.id } })).businessDate, date);
  assert.equal((await call(billsRouter, 'POST', `/${saved.id}/re-date`, { body: { newDate: '2026-10-23' } })).status, 200);
});
test('attendance changed after billing excludes personal credit and redistributes tips among eligible recipients', async () => {
  const payload = bill('PRESENT');
  payload.tipStaffIds = ['PRESENT', 'OFF'];
  await call(billsRouter, 'POST', '/', { body: payload });
  await prisma.attendance.update({ where: { propertyId_staffMemberId_date: { propertyId: 'male', staffMemberId: 'PRESENT', date } }, data: { status: 'SICK' } });
  const result = await calculateCommissionForPeriod('male', date, date);
  const excluded = result.staffResults.find(s => s.staffId === 'PRESENT');
  assert.equal(excluded.personalCommission, 0);
  assert.equal(excluded.tipsCommission, 0);
  assert.equal(excluded.diveCommission, 0);
  assert.equal(result.staffResults.find(s => s.staffId === 'OFF').tipsCommission, 24);
  assert(!result.personalDetails.some(detail => detail.staffId === 'PRESENT'));
});
test('global audit includes account events and all properties with stable older-entry pagination', async () => {
  const createdAt = new Date('2026-10-21T05:00:00Z');
  await prisma.auditLog.createMany({ data: [
    { id: 'log-a', userId: 'admin', action: 'LOGIN_SUCCESS', targetType: 'User', createdAt },
    { id: 'log-b', propertyId: 'male', action: 'STAFF_UPDATE', targetType: 'StaffMember', createdAt },
    { id: 'log-c', propertyId: 'other', action: 'BILL_CREATE', targetType: 'Bill', createdAt },
  ] });
  const first = await call(auditRouter, 'GET', '/', { query: { propertyId: 'all', limit: '2' } });
  assert.deepEqual(first.body.logs.map(log => log.id), ['log-c', 'log-b']);
  const second = await call(auditRouter, 'GET', '/', { query: { propertyId: 'all', limit: '2', cursor: first.body.nextCursor } });
  assert.equal(second.body.logs[0].action, 'LOGIN_SUCCESS');
  assert.equal(second.body.nextCursor, null);
  const own = await request(auditRouter, 'GET', '/', { user: manager, query: { propertyId: 'male' } });
  assert.deepEqual(own.body.logs.map(log => log.id), ['log-b']);
  assert.equal((await request(auditRouter, 'GET', '/', { user: manager, query: { propertyId: 'all' } })).status, 403);
});
test('activity captures user, request timing and failures without passwords, tokens or query values', async () => {
  const events = [];
  const { auditApiActivity } = loadTypeScript('src/middleware/audit.ts', { '../services/auditService': { logAuditEvent: async event => { events.push(event); } } });
  const req = { originalUrl: '/api/auth/password-reset/complete?token=secret', method: 'POST', body: { password: 'secret' } };
  const res = Object.assign(new EventEmitter(), { statusCode: 400 });
  auditApiActivity(req, res, () => {});
  res.emit('finish');
  assert.equal(events.length, 1);
  assert.equal(events[0].details.status, 400);
  assert.equal(events[0].details.path, '/api/auth/password-reset/complete');
  assert(!JSON.stringify(events[0].details).includes('secret'));
  assert(!Number.isNaN(Date.parse(events[0].details.startedAt)));
  assert.equal(typeof events[0].details.durationMs, 'number');
});
test('sign-out records an explicit user audit event', async () => {
  const events = [];
  const { authRouter } = loadTypeScript('src/routes/auth.routes.ts', { ...stubs, '../middleware/security': { authLimiter: (_req, _res, next) => next() }, '../services/auditService': { logAuditEvent: async event => events.push(event) } });
  assert.equal((await call(authRouter, 'POST', '/logout')).status, 200);
  assert.equal(events[0].action, 'LOGOUT');
  assert.equal(events[0].targetId, 'admin');
});
