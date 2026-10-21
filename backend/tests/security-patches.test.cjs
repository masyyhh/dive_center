const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('securitypatches');
const prisma = database.prisma;
const staff = { id: 'patch-staff', role: 'CENTRE_STAFF', assignedPropertyIds: ['patch-a'] };
const manager = { ...staff, role: 'PROPERTY_MANAGER' };
const admin = { ...staff, role: 'GLOBAL_ADMIN' };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (_req, _res, next) => next() }, '../services/auditService': { logAuditEvent: async () => {} } };
const { propertiesRouter } = loadTypeScript('src/routes/properties.routes.ts', stubs);
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { presenceRouter } = loadTypeScript('src/routes/presence.routes.ts', stubs);
const { reportsRouter } = loadTypeScript('src/routes/reports.routes.ts', stubs);
const { logAuditEvent } = loadTypeScript('src/services/auditService.ts', { '../db': { prisma } });
const { withPropertyPayrollTransaction } = loadTypeScript('src/utils/payrollTransaction.ts');
const call = (router, method, url, body, user = staff) => request(router, method, url, { body, user });
const bill = (checkNumber, propertyId = 'patch-a', businessDate = '2026-10-21') => ({ propertyId, checkNumber, businessDate, guestName: 'Fixture', roomNumber: '104', items: [{ itemId: `item-${propertyId}`, itemName: 'Fixture', categoryName: 'Dives', quantity: 1, unitPrice: 10 }] });
let source;
test.before(async () => {
  for (const id of ['patch-a', 'patch-b']) {
    await prisma.property.create({ data: { id, code: id, name: id, pmsPropertyCode: 'OLHU', nextCheckNumber: 1000 } });
    await prisma.category.create({ data: { id: `category-${id}`, propertyId: id, name: 'Dives' } });
    await prisma.item.create({ data: { id: `item-${id}`, propertyId: id, categoryId: `category-${id}`, code: 'DIVE', name: 'Fixture', price: 10 } });
  }
  await prisma.user.create({ data: { id: staff.id, username: 'patch-fixture', name: 'Fixture', passwordHash: 'fixture' } });
  await prisma.staffMember.create({ data: { id: 'roster-fixture', propertyId: 'patch-a', name: 'Fixture', roleTitle: 'Instructor', hireDate: '2026-01-01' } });
});
test.after(async () => { await database.dispose(); });
test('PMS mappings reject manager set/clear variants but retain ordinary updates and admin set/clear/omit', async () => {
  for (const value of ['AQUA', null, '']) {
    assert.equal((await call(propertiesRouter, 'PUT', '/patch-a', { pmsPropertyCode: value }, manager)).status, 403);
    assert.equal((await prisma.property.findUnique({ where: { id: 'patch-a' } })).pmsPropertyCode, 'OLHU');
  }
  assert.equal((await call(propertiesRouter, 'PUT', '/patch-a', { name: 'Renamed' }, manager)).status, 200);
  for (const value of ['AQUA', null, '', 'OLHU']) assert.equal((await call(propertiesRouter, 'PUT', '/patch-a', { pmsPropertyCode: value }, admin)).status, 200);
  assert.equal((await call(propertiesRouter, 'PUT', '/patch-a', { name: 'Still mapped' }, admin)).status, 200);
  assert.equal((await prisma.property.findUnique({ where: { id: 'patch-a' } })).pmsPropertyCode, 'OLHU');
});
test('real audit FK inserts survive spoofed header/query/body context and keep explicit trusted context', async () => {
  for (const selector of ['headers', 'query', 'body']) {
    for (const id of ['patch-b', 'nonexistent-property']) {
      const req = { headers: {}, query: {}, body: {}, user: staff };
      req[selector][selector === 'headers' ? 'x-property-id' : 'propertyId'] = id;
      await logAuditEvent({ req, action: 'PATCH_ACCOUNT_EVENT', targetType: 'User' });
    }
  }
  const rows = await prisma.auditLog.findMany({ where: { action: 'PATCH_ACCOUNT_EVENT' } });
  assert.equal(rows.length, 6); assert(rows.every(row => row.propertyId === null && row.userId === staff.id));
  await logAuditEvent({ req: { headers: { 'x-property-id': 'nonexistent-property' } }, userId: staff.id, propertyId: 'patch-a', action: 'PATCH_RESOURCE_EVENT', targetType: 'Fixture' });
  assert.equal((await prisma.auditLog.findFirst({ where: { action: 'PATCH_RESOURCE_EVENT' } })).propertyId, 'patch-a');
});
test('parallel route creates across months reserve exactly one check while another property works', async () => {
  const results = await Promise.all(['2026-10-21', '2026-11-21'].map(date => call(billsRouter, 'POST', '/', bill(1, 'patch-a', date))));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => [400, 409].includes(result.status)).length, 1);
  assert.equal(await prisma.bill.count({ where: { propertyId: 'patch-a', checkNumber: 1 } }), 1);
  assert.equal((await call(billsRouter, 'POST', '/', bill(1, 'patch-b'), admin)).status, 201);
});
test('database index independently prevents duplicate live checks, retains rebates and releases deletes', async () => {
  const data = { propertyId: 'patch-a', checkNumber: 2, businessDate: '2026-10-21', guestName: 'Fixture', roomNumber: '104', createdById: staff.id };
  const results = await Promise.allSettled([prisma.bill.create({ data }), prisma.bill.create({ data })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'P2002');
  source = results.find(result => result.status === 'fulfilled').value;
  await prisma.bill.update({ where: { id: source.id }, data: { status: 'REBATED' } });
  await assert.rejects(prisma.bill.create({ data }), error => error.code === 'P2002');
  await prisma.bill.update({ where: { id: source.id }, data: { status: 'DELETED' } });
  assert.equal((await call(billsRouter, 'POST', '/', bill(2))).status, 201);
  assert.equal((await call(billsRouter, 'POST', `/${source.id}/rebate`, { reason: 'Fixture' })).status, 409);
  assert.equal((await prisma.bill.findUnique({ where: { id: source.id } })).status, 'DELETED');
});
async function waitForAdvisoryWaiter() {
  const deadline = Date.now() + 4000;
  do {
    const rows = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event = 'advisory' AND datname = current_database()`;
    if (rows[0].count > 0) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  throw Error('Route never waited on the database payroll lock');
}
async function blockedByCommittedLock(action, mutate = async () => {}) {
  let release, ready;
  const gate = new Promise(resolve => { release = resolve; });
  const acquired = new Promise(resolve => { ready = resolve; });
  const blocker = withPropertyPayrollTransaction(prisma, 'patch-a', async tx => {
    await mutate(tx);
    await tx.monthLock.upsert({ where: { propertyId_yearMonth: { propertyId: 'patch-a', yearMonth: '2026-10' } }, create: { propertyId: 'patch-a', yearMonth: '2026-10', lockedById: staff.id, isLocked: true }, update: { isLocked: true } });
    ready(); await gate;
  });
  await acquired;
  const pending = action();
  try { await waitForAdvisoryWaiter(); } finally { release(); }
  await blocker;
  return pending;
}
test('every staff payroll mutation waits for lock commit then rejects without changing rows', async () => {
  const created = await call(billsRouter, 'POST', '/', bill(3));
  assert.equal(created.status, 201); const id = created.body.bill.id;
  const actions = [
    () => call(billsRouter, 'POST', '/', bill(4)),
    () => call(billsRouter, 'POST', `/${id}/re-date`, { newDate: '2026-11-01' }),
    () => call(billsRouter, 'POST', `/${id}/rebate`, { reason: 'Fixture' }),
    () => call(billsRouter, 'DELETE', `/${id}`, {}),
    () => call(presenceRouter, 'POST', '/day', { propertyId: 'patch-a', date: '2026-10-21', records: [{ staffMemberId: 'roster-fixture', status: 'ABSENT' }] }),
  ];
  for (const action of actions) {
    await prisma.monthLock.deleteMany();
    const before = await prisma.bill.findMany({ include: { items: true }, orderBy: { id: 'asc' } });
    assert.equal((await blockedByCommittedLock(action)).status, 423);
    assert.deepEqual(await prisma.bill.findMany({ include: { items: true }, orderBy: { id: 'asc' } }), before);
    assert.equal(await prisma.attendance.count(), 0);
  }
  await prisma.monthLock.deleteMany();
  assert.equal((await call(presenceRouter, 'POST', '/day', { propertyId: 'patch-a', date: '2026-10-21', records: [{ staffMemberId: 'roster-fixture', status: 'PRESENT' }] })).status, 200);
});
test('bill operations re-read a concurrent re-date before checking the now-current locked month', async () => {
  const saved = await call(billsRouter, 'POST', '/', bill(5)); const id = saved.body.bill.id;
  for (const [method, suffix, body] of [['POST', '/re-date', { newDate: '2026-12-01' }], ['POST', '/rebate', { reason: 'Fixture' }], ['DELETE', '', {}]]) {
    await prisma.monthLock.deleteMany();
    await prisma.bill.update({ where: { id }, data: { businessDate: '2026-09-01' } });
    const result = await blockedByCommittedLock(() => call(billsRouter, method, `/${id}${suffix}`, body), tx => tx.bill.update({ where: { id }, data: { businessDate: '2026-10-21' } }));
    assert.equal(result.status, 423);
    const current = await prisma.bill.findUnique({ where: { id } });
    assert.equal(current.businessDate, '2026-10-21'); assert.equal(current.status, 'ACTIVE');
  }
  await prisma.monthLock.deleteMany();
});
test('manager month-lock waits for an earlier property mutation to finish', async () => {
  let release, ready;
  const gate = new Promise(resolve => { release = resolve; }); const acquired = new Promise(resolve => { ready = resolve; });
  const mutation = withPropertyPayrollTransaction(prisma, 'patch-a', async tx => { ready(); await gate; await tx.attendance.updateMany({ where: { propertyId: 'patch-a' }, data: { status: 'OFF' } }); });
  await acquired;
  const pending = call(reportsRouter, 'POST', '/month-lock', { propertyId: 'patch-a', yearMonth: '2026-10', lock: true }, manager);
  try { await waitForAdvisoryWaiter(); } finally { release(); }
  await mutation; assert.equal((await pending).status, 200);
  assert.equal((await prisma.attendance.findFirst()).status, 'OFF');
  assert.equal((await prisma.monthLock.findFirst()).isLocked, true);
  assert.equal((await call(reportsRouter, 'POST', '/month-lock', { propertyId: 'patch-a', yearMonth: '2026-10', lock: false }, manager)).status, 200);
});
test('unlocked bill lifecycle remains usable and transaction failure never returns success', async () => {
  await prisma.monthLock.deleteMany();
  const created = await call(billsRouter, 'POST', '/', bill(6)); assert.equal(created.status, 201);
  const id = created.body.bill.id;
  assert.equal((await call(billsRouter, 'POST', `/${id}/re-date`, { newDate: '2026-11-01' })).status, 200);
  assert.equal((await call(billsRouter, 'POST', `/${id}/rebate`, { reason: 'Fixture' })).status, 200);
  assert.equal((await call(billsRouter, 'DELETE', `/${id}`, {})).status, 200);
  assert.equal((await call(billsRouter, 'POST', `/${id}/rebate`, { reason: 'Fixture' })).status, 200);
  const failing = { $transaction: async () => { throw Error('Fixture commit failure'); } };
  const { presenceRouter: failingRouter } = loadTypeScript('src/routes/presence.routes.ts', { ...stubs, '../db': { prisma: failing } }, { console: { error() {} } });
  assert.equal((await call(failingRouter, 'POST', '/day', { propertyId: 'patch-a', date: '2026-10-21', records: [] })).status, 500);
});
test('single-connection transactions persist real audit events without borrowing a second connection', async () => {
  const { PrismaClient } = require('@prisma/client');
  const url = new URL(database.databaseUrl); url.searchParams.set('connection_limit', '1'); url.searchParams.set('pool_timeout', '1');
  const single = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const { ['../services/auditService']: _auditStub, ...realAuditStubs } = stubs;
  const bindings = { ...realAuditStubs, '../db': { prisma: single } };
  try {
    const { billsRouter: realBills } = loadTypeScript('src/routes/bills.routes.ts', bindings);
    const { presenceRouter: realPresence } = loadTypeScript('src/routes/presence.routes.ts', bindings);
    const { reportsRouter: realReports } = loadTypeScript('src/routes/reports.routes.ts', bindings);
    await prisma.monthLock.deleteMany();
    const created = await call(realBills, 'POST', '/', bill(7)); assert.equal(created.status, 201);
    assert.equal(await prisma.auditLog.count({ where: { action: 'BILL_CREATE', targetId: created.body.bill.id } }), 1);
    assert.equal((await call(realPresence, 'POST', '/day', { propertyId: 'patch-a', date: '2026-10-21', records: [] })).status, 200);
    assert.equal((await call(realReports, 'POST', '/month-lock', { propertyId: 'patch-a', yearMonth: '2026-10', lock: true }, manager)).status, 200);
    assert.equal(await prisma.auditLog.count({ where: { action: 'MONTH_LOCK', propertyId: 'patch-a' } }), 1);
  } finally { await single.$disconnect(); }
});
test('transaction-owned audit insertion rolls back with a failed payroll mutation', async () => {
  await assert.rejects(withPropertyPayrollTransaction(prisma, 'patch-a', async tx => {
    await logAuditEvent({ client: tx, userId: staff.id, propertyId: 'patch-a', action: 'PATCH_ROLLBACK_EVENT', targetType: 'Fixture' });
    throw Error('Fixture rollback');
  }), /Fixture rollback/);
  assert.equal(await prisma.auditLog.count({ where: { action: 'PATCH_ROLLBACK_EVENT' } }), 0);
});
