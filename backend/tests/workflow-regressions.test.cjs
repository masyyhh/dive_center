const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request, FixedDate } = require('./helpers/runtime.cjs');
const auth = { requireAuth: (req, res, next) => next() };
const emptyCommissions = { staffResults: [], personalDetails: [], grandTotal: 0 };

function reportFixture(lockedMonth = '2026-09') {
  let calculations = 0;
  const locks = [{ propertyId: 'male', yearMonth: lockedMonth, isLocked: true }];
  const prisma = {
    property: { findUnique: async () => ({ id: 'male', name: 'Male', currency: 'USD' }) },
    bill: { findMany: async () => [] },
    monthLock: {
      findMany: async ({ where }) => locks.filter(lock => lock.propertyId === where.propertyId && lock.isLocked && (where.yearMonth.in ? where.yearMonth.in.includes(lock.yearMonth) : lock.yearMonth >= where.yearMonth.gte && lock.yearMonth <= where.yearMonth.lte)),
      findUnique: async ({ where }) => locks.find(lock => lock.yearMonth === where.propertyId_yearMonth.yearMonth) || null,
    },
  };
  const { reportsRouter } = loadTypeScript('src/routes/reports.routes.ts', {
    '../db': { prisma }, '../middleware/auth': auth,
    '../services/auditService': { logAuditEvent: async () => {} },
    '../services/excelService': {},
    '../services/commissionService': { calculateCommissionForPeriod: async () => { calculations++; return emptyCommissions; } },
  });
  return { router: reportsRouter, calculations: () => calculations };
}
const range = { propertyId: 'male', startDate: '2026-08-01', endDate: '2026-10-31' };

test('report detects a locked intermediate month in a multi-month period', async () => {
  const { router } = reportFixture();
  const result = await request(router, 'GET', '/dashboard', { query: range });
  assert.equal(result.status, 200);
  assert.equal(result.body.period.isLocked, true);
});
test('recompute rejects a period containing a locked intermediate month', async () => {
  const fixture = reportFixture();
  const result = await request(fixture.router, 'POST', '/recompute', { body: range });
  assert.equal(result.status, 423);
  assert.equal(fixture.calculations(), 0);
});
test('recompute permits an unlocked period', async () => {
  const fixture = reportFixture('2026-07');
  assert.equal((await request(fixture.router, 'POST', '/recompute', { body: range })).status, 200);
  assert.equal(fixture.calculations(), 1);
});
test('reports reject impossible dates and reversed ranges', async () => {
  for (const dates of [{ startDate: '2026-02-30', endDate: '2026-03-01' }, { startDate: '2026-10-31', endDate: '2026-08-01' }]) {
    for (const [method, url, key] of [['GET', '/dashboard', 'query'], ['POST', '/recompute', 'body']]) {
      const fixture = reportFixture();
      assert.equal((await request(fixture.router, method, url, { [key]: { propertyId: 'male', ...dates } })).status, 400);
      assert.equal(fixture.calculations(), 0);
    }
  }
});

function presenceFixture(attendances = []) {
  const prisma = {
    staffMember: { findMany: async () => [{ id: 'current', hireDate: '2026-01-01', leavingDate: null }] },
    attendance: { findMany: async () => attendances },
  };
  return loadTypeScript('src/routes/presence.routes.ts', {
    '../db': { prisma }, '../middleware/auth': auth, '../services/auditService': {},
  }, { Date: FixedDate }).presenceRouter;
}
test('attendance counts only staff employed on the selected day', async () => {
  const router = presenceFixture([{ date: '2026-10-18', staffMemberId: 'former' }]);
  const result = await request(router, 'GET', '/month-status', { query: { propertyId: 'male', yearMonth: '2026-10' } });
  assert.deepEqual(result.body.dayStatuses['2026-10-18'], { status: 'missing', markedCount: 0, expectedCount: 1 });
});
test('attendance uses Maldives today after midnight, including yesterday in missing days', async () => {
  const result = await request(presenceFixture(), 'GET', '/month-status', { query: { propertyId: 'male', yearMonth: '2026-10' } });
  assert.equal(result.body.dayStatuses['2026-10-20'].status, 'missing');
  assert.equal(result.body.missingDaysCount, 19);
});
test('attendance rejects impossible calendar dates and months', async () => {
  assert.equal((await request(presenceFixture(), 'GET', '/month-status', { query: { propertyId: 'male', yearMonth: '2026-13' } })).status, 400);
  assert.equal((await request(presenceFixture(), 'GET', '/day', { query: { propertyId: 'male', date: '2026-02-30' } })).status, 400);
  assert.equal((await request(presenceFixture(), 'POST', '/day', { body: { propertyId: 'male', date: '2026-02-30', records: [] } })).status, 400);
});

test('base leader override is divided among leaders employed that day', async () => {
  const staff = [
    { id: 'current', hireDate: '2026-01-01', leavingDate: null },
    { id: 'future', hireDate: '2026-11-01', leavingDate: null },
    { id: 'former', hireDate: '2026-01-01', leavingDate: '2026-09-30' },
  ].map(s => ({ ...s, name: s.id, roleTitle: 'Leader', isBaseLeaderOverride: true }));
  const prisma = {
    staffMember: { findMany: async () => staff },
    attendance: { findMany: async () => [] },
    bill: { findMany: async () => [{ businessDate: '2026-10-20', tipAmount: 0, items: [{ quantity: 4, item: { propertyId: 'male', poolType: 'COURSE_POOL', poolContribution: 25 } }] }] },
  };
  const { calculateCommissionForPeriod } = loadTypeScript('src/services/commissionService.ts', { '../db': { prisma } });
  const result = await calculateCommissionForPeriod('male', '2026-10-01', '2026-10-31');
  assert.equal(result.staffResults.find(s => s.staffId === 'current').overrideCommission, 10);
  assert.equal(result.grandTotal, 10);
});

test('room suggestions query the Maldives business date', async () => {
  const queries = [];
  const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', {
    '../db': { prisma: { bill: { findFirst: async query => { queries.push(query); return null; } } } },
    '../middleware/auth': auth, '../services/auditService': {},
  }, { Date: FixedDate });
  await request(billsRouter, 'GET', '/room-lookup', { query: { propertyId: 'male', roomNumber: '101' } });
  assert.equal(queries[0].where.businessDate, '2026-10-20');
});
test('room suggestions do not return a previous occupant from an older bill', async () => {
  const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', {
    '../db': { prisma: { bill: { findFirst: async ({ where }) => where.businessDate ? null : { guestName: 'Previous occupant', businessDate: '2026-01-01' } } } },
    '../middleware/auth': auth, '../services/auditService': {},
  });
  const result = await request(billsRouter, 'GET', '/room-lookup', { query: { propertyId: 'male', roomNumber: '101' } });
  assert.deepEqual(result.body, { found: false });
});

test('date validation preserves leap days and rejects invalid input types', () => {
  const { isBusinessDate, isYearMonth, isDateRange, businessToday } = loadTypeScript('src/utils/dates.ts');
  assert.equal(isBusinessDate('2024-02-29'), true);
  assert.equal(isBusinessDate('2026-02-29'), false);
  assert.equal(isBusinessDate(['2026-10-20']), false);
  assert.equal(isYearMonth('2026-00'), false);
  assert.equal(isYearMonth('2026-12'), true);
  assert.equal(isDateRange('2026-10-20', '2026-10-20'), true);
  assert.equal(businessToday(new Date('2026-10-19T18:59:59Z')), '2026-10-19');
  assert.equal(businessToday(new Date('2026-10-19T19:00:00Z')), '2026-10-20');
});
test('invalid payroll months and export dates are rejected before any writes or generation', async () => {
  const fixture = reportFixture();
  assert.equal((await request(fixture.router, 'POST', '/month-lock', { body: { propertyId: 'male', yearMonth: '2026-13', lock: true } })).status, 400);
  assert.equal((await request(fixture.router, 'GET', '/export/monthly', { query: { propertyId: 'male', yearMonth: '2026-00' } })).status, 400);
  assert.equal((await request(fixture.router, 'GET', '/export/daily', { query: { propertyId: 'male', date: '2026-02-30' } })).status, 400);
});
test('bill creation and re-dating reject impossible business dates before database access', async () => {
  const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', {
    '../db': { prisma: {} }, '../middleware/auth': auth, '../services/auditService': {},
  });
  const bill = { propertyId: 'male', checkNumber: 1, businessDate: '2026-02-30', guestName: 'Test', roomNumber: '101', items: [{ itemName: 'Dive', categoryName: 'Dives', quantity: 1, unitPrice: 10 }] };
  assert.equal((await request(billsRouter, 'POST', '/', { body: bill })).status, 400);
  assert.equal((await request(billsRouter, 'POST', '/bill-1/re-date', { body: { newDate: '2026-02-30' } })).status, 400);
});
test('room lookup still offers the current guest from a bill dated today', async () => {
  const guest = { guestName: 'Current guest', roomNumber: '101', businessDate: '2026-10-20' };
  const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', {
    '../db': { prisma: { bill: { findFirst: async ({ where }) => where.businessDate === guest.businessDate ? guest : null } } },
    '../middleware/auth': auth, '../services/auditService': {},
  }, { Date: FixedDate });
  const result = await request(billsRouter, 'GET', '/room-lookup', { query: { propertyId: 'male', roomNumber: '101' } });
  assert.deepEqual(result.body, { found: true, guest });
});
