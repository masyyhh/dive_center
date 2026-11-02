const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request, FixedDate } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('globaldashboard');
const { prisma } = database;
const admin = { id: 'admin', role: 'GLOBAL_ADMIN', assignedPropertyIds: [] };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) } };
const { reportsRouter } = loadTypeScript('src/routes/reports.routes.ts', stubs, { Date: FixedDate });
const query = { startDate: '2026-10-18', endDate: '2026-10-21' };
const dashboard = (patch = {}, user = admin) => request(reportsRouter, 'GET', '/global-dashboard', { query: { ...query, ...patch }, user });

test.before(async () => {
  await prisma.property.createMany({ data: [
    { id: 'a', code: 'A', name: 'Centre A' },
    { id: 'b', code: 'B', name: 'Centre B', currency: 'EUR', currencySymbol: '€', isActive: false },
    { id: 'c', code: 'C', name: 'Empty property' },
    { id: 'removed', code: 'DEL', name: 'Removed property', deletedAt: new Date() },
  ] });
  await prisma.user.create({ data: { id: 'admin', username: 'global-dashboard-admin', name: 'Admin', passwordHash: 'fixture', role: 'GLOBAL_ADMIN' } });
  await prisma.staffMember.createMany({ data: [
    { id: 'leader', propertyId: 'a', name: 'Leader', roleTitle: 'Base Leader', hireDate: '2026-10-18', isBaseLeaderOverride: true },
    { id: 'short-employment', propertyId: 'a', name: 'Short employment', roleTitle: 'Instructor', hireDate: '2026-10-19', leavingDate: '2026-10-19' },
    { id: 'inactive', propertyId: 'a', name: 'Inactive', roleTitle: 'Instructor', hireDate: '2026-01-01', isActive: false },
    { id: 'non-dive', propertyId: 'a', name: 'Retail', roleTitle: 'Retail', hireDate: '2026-01-01', isDiveStaff: false },
    { id: 'b-staff', propertyId: 'b', name: 'B staff', roleTitle: 'Instructor', hireDate: '2026-10-18' },
    { id: 'removed-staff', propertyId: 'removed', name: 'Removed', roleTitle: 'Instructor', hireDate: '2026-01-01' },
  ] });
  await prisma.attendance.createMany({ data: [
    { propertyId: 'a', staffMemberId: 'leader', date: '2026-10-19', status: 'PRESENT' },
    { propertyId: 'a', staffMemberId: 'non-dive', date: '2026-10-18', status: 'PRESENT' },
    { propertyId: 'b', staffMemberId: 'b-staff', date: '2026-10-18', status: 'OFF' },
  ] });
  await prisma.bill.create({ data: { id: 'a-bill', propertyId: 'a', createdById: 'admin', checkNumber: 100, businessDate: '2026-10-19', guestName: 'Guest', roomNumber: '101', grossAmount: 200, discountAmount: 50, netAmount: 180, tipAmount: 10, tipStaffIdsJson: '["leader"]', items: { create: { itemName: 'Dive', categoryName: 'Dives', quantity: 1, unitPrice: 200, lineTotal: 150, poolTypeSnapshot: 'DIVE_POOL', poolContributionAmount: 15, guideStaffId: 'leader', personalCommissionsJson: '{"guide":5}' } } } });
  await prisma.bill.createMany({ data: [
    { propertyId: 'b', checkNumber: 101, businessDate: '2026-10-19', grossAmount: 100, discountAmount: 10, netAmount: 90 },
    { propertyId: 'a', checkNumber: 102, businessDate: '2026-10-19', grossAmount: 9999, discountAmount: 99, netAmount: 9900, status: 'REBATED' },
    { propertyId: 'a', checkNumber: 103, businessDate: '2026-10-19', grossAmount: 9999, discountAmount: 99, netAmount: 9900, status: 'DELETED' },
    { propertyId: 'a', checkNumber: 104, businessDate: '2026-10-17', grossAmount: 555, discountAmount: 5, netAmount: 550 },
    { propertyId: 'removed', checkNumber: 105, businessDate: '2026-10-19', grossAmount: 9999, discountAmount: 99, netAmount: 9900 },
  ].map(bill => ({ ...bill, createdById: 'admin', guestName: 'Guest', roomNumber: '101' })) });
});
test.after(() => database.dispose());

test('global comparison uses active bills, excludes removed properties, and retains empty and inactive centres', async () => {
  const result = await dashboard();
  assert.equal(result.status, 200);
  assert.equal(result.body.totals.propertyCount, 3);
  const [a, b, c] = result.body.properties;
  assert.equal(a.revenue, 150); assert.equal(a.discounts, 50); assert.equal(a.billCount, 1);
  assert.equal(b.revenue, 90); assert.equal(b.isActive, false);
  assert.equal(c.revenue, 0); assert.equal(c.commissions, 0); assert.equal(c.missingAttendance, 0);
  assert(!result.body.properties.some(row => row.propertyId === 'removed'));
  assert.deepEqual(result.body.totals.currencies, [
    { currency: 'USD', revenue: 150, discounts: 50, commissions: 31.5, billCount: 1 },
    { currency: 'EUR', revenue: 90, discounts: 10, commissions: 0, billCount: 1 },
  ]);
});

test('global commissions reconcile to the existing property payroll including pool shares, override, fixed payments and tips', async () => {
  const { body } = await dashboard();
  const report = await request(reportsRouter, 'GET', '/dashboard', { query: { ...query, propertyId: 'a' }, user: admin });
  assert.equal(report.status, 200);
  assert.equal(body.properties[0].commissions, report.body.headline.totalCommission);
  assert.equal(body.properties[0].commissions, 31.5);
});

test('missing attendance counts employed dive staff on past partial and empty days, excluding today and future dates', async () => {
  const { body } = await dashboard();
  assert.equal(body.period.attendanceBefore, '2026-10-20');
  assert.equal(body.properties[0].missingAttendance, 2);
  assert.equal(body.properties[0].missingDays, 2);
  assert.equal(body.properties[0].firstMissingDate, '2026-10-18');
  assert.equal(body.properties[1].missingAttendance, 1);
  assert.equal(body.totals.missingAttendance, 3);
  const today = await dashboard({ startDate: '2026-10-20', endDate: '2026-10-21' });
  assert.equal(today.body.totals.missingAttendance, 0);
  assert(today.body.properties.every(row => row.firstMissingDate === null));
});

test('global overview requires authentication and global administrator role regardless of property selectors', async () => {
  assert.equal((await dashboard({}, null)).status, 401);
  for (const role of ['PROPERTY_MANAGER', 'CENTRE_STAFF']) {
    assert.equal((await dashboard({ propertyId: 'a' }, { id: 'manager', role, assignedPropertyIds: ['a', 'b', 'c'] })).status, 403);
  }
});

test('invalid, reversed and oversized ranges are rejected before report work', async () => {
  for (const patch of [{ startDate: '' }, { startDate: ['2026-10-18'] }, { endDate: '2026-02-30' }, { startDate: '2026-10-22' }, { startDate: '2024-01-01', endDate: '2025-01-01' }]) {
    assert.equal((await dashboard(patch)).status, 400);
  }
});
