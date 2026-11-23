const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const money = loadTypeScript('src/utils/commissionMoney.ts');
const staff = ['c', 'b', 'a'].map(id => ({ id, name: id, roleTitle: 'Instructor', hireDate: '2026-01-01', leavingDate: null,
  isActive: true, isDiveStaff: true, isCoursePoolSharing: true, isDivePoolSharing: true, isBaseLeaderOverride: true }));
const line = (id, poolTypeSnapshot, poolContributionAmount, extra = {}) => ({ id, itemName: id, quantity: 1, poolTypeSnapshot, poolContributionAmount, ...extra });
const bill = (date, items, extra = {}) => ({ id: date, businessDate: date, checkNumber: 1, tipAmount: 0, items, ...extra });
function fixture(bills, { propertyId = 'iruveli', locks = [], people = staff, tripEnv = {}, allocations = [] } = {}) {
  const env = { ...process.env, IRUVELI_COMMISSION_PROPERTY_ID: 'iruveli', IRUVELI_COMMISSION_EFFECTIVE_DATE: '2026-11-17', ...tripEnv };
  const prisma = {
    monthLock: { findMany: async () => locks },
    tankCommissionAllocation: { findMany: async ({ where }) => {
      assert.equal(where.session.propertyId, propertyId);
      assert.equal(where.session.status, 'APPROVED');
      assert(where.session.businessDate.gte >= '2026-11-24');
      return allocations;
    } },
    staffMember: { findMany: async () => people },
    attendance: { findMany: async ({ where }) => [...new Set(bills.map(row => row.businessDate))].filter(date => date >= where.date.gte && date <= where.date.lte).flatMap(date => people.map(row => ({ date, staffMemberId: row.id, status: 'PRESENT' }))) },
  };
  const service = loadTypeScript('src/services/commissionService.ts', { '../db': { prisma } }, { process: { env } });
  return (start = '2026-11-17', end = start) => service.calculateCommissionForPeriod(propertyId, start, end, 'a', bills.filter(row => row.businessDate >= start && row.businessDate <= end));
}
test('exact decimals and equal allocation conserve cents under reordered inputs', () => {
  assert.equal(money.productCents(2.01, 0.5), 101);
  assert.equal(money.sumProductCents([[0.004], [0.004]]), 1);
  for (let total = 0; total < 150; total++) for (let count = 0; count < 10; count++) {
    const ids = Array.from({ length: count }, (_, index) => String(index));
    const result = money.splitCommissionCents(total, ids);
    assert.deepEqual(result, money.splitCommissionCents(total, [...ids].reverse().concat(ids)));
    assert.equal(result.shares.reduce((sum, row) => sum + row.amountCents, 0) + result.unallocatedCents, total);
  }
});
test('schema-free Iruveli pools, tips and production override basis reconcile', async () => {
  const result = await fixture([bill('2026-11-17', [line('c', 'COURSE_POOL', 10), line('d', 'DIVE_POOL', 1)], { tipAmount: 0.01, tipStaffIdsJson: '["c","a","b"]' })])();
  assert.equal(result.grandTotal, 12.11);
  const a = result.staffResults.find(row => row.staffId === 'a');
  assert.equal(a.courseCommission, 3.34);
  assert.equal(a.tipsCommission, 0.01);
  assert.equal(a.overrideCommission, 0.37);
  for (const row of result.staffResults) assert.equal(row.cents.totalCommission, row.cents.courseCommission + row.cents.diveCommission + row.cents.overrideCommission + row.cents.tipsCommission + row.cents.personalCommission);
  assert.equal(result.breakdownDetails.reduce((sum, row) => sum + row.amountCents, 0), a.cents.totalCommission);
});
test('other properties, historical dates and old month locks retain original pay', async () => {
  const data = [bill('2026-11-17', [line('c', 'COURSE_POOL', 10)])];
  const other = await fixture(data, { propertyId: 'other' })();
  assert.equal(other.grandTotal, 11.01);
  assert.equal(other.calculationVersion, undefined);
  const historical = await fixture([bill('2026-11-16', data[0].items)])('2026-11-16');
  assert.equal(historical.grandTotal, 11.01);
  const locked = await fixture(data, { locks: [{ yearMonth: '2026-11' }] })();
  assert.equal(locked.grandTotal, 11.01);
  assert.equal(locked.calculationVersion, undefined);
});
test('daily and combined new payroll add up; mixed periods preserve the old portion', async () => {
  const calculate = fixture(['2026-11-16', '2026-11-17', '2026-11-18'].map(date => bill(date, [line(date, 'NONE', 0, { sellerStaffId: 'a', personalCommissionsJson: '{"seller":0.01}', commissionDiscountFactor: 0.6 })])));
  assert.equal((await calculate('2026-11-17', '2026-11-18')).grandTotal, 0.02);
  assert.equal((await calculate('2026-11-16', '2026-11-18')).grandTotal, 0.03);
});
test('no recipients preserves unallocated balances and personal rates are full per instructor', async () => {
  const empty = await fixture([bill('2026-11-17', [line('c', 'COURSE_POOL', 10)])], { people: [] })();
  assert.equal(empty.grandTotal, 0);
  assert.equal(empty.unallocatedCommissions.reduce((sum, row) => sum + row.amountCents, 0), 1100);
  const paid = await fixture([bill('2026-11-17', [line('p', 'NONE', 0, { personalCommissionsJson: '{"instructor":2.01}', commissionDiscountFactor: 0.5, instructorCredits: [{ staffId: 'a' }, { staffId: 'b' }] })])])();
  assert.equal(paid.grandTotal, 2.02);
  assert.deepEqual(paid.personalDetails.map(row => row.amountCents), [101, 101]);
});
test('payroll continues to use the live property configuration without capability columns', () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/services/commissionService.ts'), 'utf8');
  for (const forbidden of ['reportLayout', 'baseLeaderOverrideBasis']) assert(!source.includes(forbidden));
});

test('historical payroll is identical and approved trip cents appear exactly once after rollout', async () => {
  const bills = ['2026-11-23', '2026-11-24'].map(day => bill(day, [line(day, 'COURSE_POOL', 10)]));
  const old = fixture(bills);
  const withTrips = fixture(bills, {
    tripEnv: { TRIPS_ENABLED: 'true', TRIPS_START_DATE: '2026-11-24' },
    allocations: [{ id: 'trip-pay', staffId: 'a', amountCents: 34, role: 'Crew',
      session: { businessDate: '2026-11-24', boatName: 'Dhoni', activityType: 'Dive' } }],
  });
  assert.deepEqual(await withTrips('2026-11-23'), await old('2026-11-23'));
  const before = await old('2026-11-23', '2026-11-24');
  const after = await withTrips('2026-11-23', '2026-11-24');
  const a = after.staffResults.find(row => row.staffId === 'a');
  assert.equal(a.tankCommission, 0.34);
  assert.equal(a.tripsWorked, 1);
  assert.equal(money.productCents(after.grandTotal) - money.productCents(before.grandTotal), 34);
  assert.equal(after.breakdownDetails.filter(row => row.kind === 'TANK').length, 1);
  assert.equal(after.breakdownDetails.reduce((sum, row) => sum + row.amountCents, 0), a.cents.totalCommission);
});

test('global Trips activation includes approved payouts for the requested property only', async () => {
  const inOtherProperty = fixture([], {
    propertyId: 'other',
    tripEnv: { TRIPS_ENABLED: 'true', TRIPS_START_DATE: '2026-11-24' },
    allocations: [{ id: 'other-trip', staffId: 'a', amountCents: 67, role: 'Crew',
      session: { businessDate: '2026-11-24', boatName: 'Dhoni', activityType: 'Dive' } }],
  });
  const historical = await inOtherProperty('2026-11-23');
  assert.equal(historical.grandTotal, 0);
  assert.equal(historical.staffResults.find(row => row.staffId === 'a').tripsWorked, undefined);
  const updated = await inOtherProperty('2026-11-24');
  assert.equal(updated.grandTotal, 0.67);
  assert.equal(updated.staffResults.find(row => row.staffId === 'a').tripsWorked, 1);
  assert.equal(updated.calculationVersion, undefined);
});
