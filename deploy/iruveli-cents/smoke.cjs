const assert = require('node:assert/strict');
process.env.IRUVELI_COMMISSION_PROPERTY_ID = 'iruveli-smoke';
process.env.IRUVELI_COMMISSION_EFFECTIVE_DATE = '2026-11-17';
const { productCents, splitCommissionCents } = require('/app/dist/utils/commissionMoney');
assert.equal(productCents(2.01, 0.5), 101);
assert.deepEqual(splitCommissionCents(1, ['c', 'b', 'a']).shares.map(row => row.amountCents), [1, 0, 0]);
const staff = ['c', 'b', 'a'].map(id => ({ id, name: id, roleTitle: 'Instructor', hireDate: '2026-01-01', leavingDate: null,
  isActive: true, isDiveStaff: true, isCoursePoolSharing: true, isDivePoolSharing: true, isBaseLeaderOverride: true }));
const prisma = {
  monthLock: { findMany: async () => [] },
  staffMember: { findMany: async () => staff },
  attendance: { findMany: async () => staff.map(row => ({ date: '2026-11-17', staffMemberId: row.id, status: 'PRESENT' })) },
};
const dbPath = require.resolve('/app/dist/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma } };
const { calculateCommissionForPeriod } = require('/app/dist/services/commissionService');
const bill = { id: 'b', businessDate: '2026-11-17', checkNumber: 1, tipAmount: 0.01, tipStaffIdsJson: '["c","b","a"]', items: [
  { id: 'course', itemName: 'Course', quantity: 1, poolTypeSnapshot: 'COURSE_POOL', poolContributionAmount: 10 },
  { id: 'dive', itemName: 'Dive', quantity: 1, poolTypeSnapshot: 'DIVE_POOL', poolContributionAmount: 1 },
] };
(async () => {
  const result = await calculateCommissionForPeriod('iruveli-smoke', '2026-11-17', '2026-11-17', 'a', [bill]);
  assert.equal(result.grandTotal, 12.11); // Preserve production's course + dive 10% override.
  const a = result.staffResults.find(row => row.staffId === 'a');
  assert.equal(a.courseCommission, 3.34);
  assert.equal(a.tipsCommission, 0.01);
  assert.equal(a.overrideCommission, 0.37);
  assert.equal(result.breakdownDetails.reduce((sum, row) => sum + row.amountCents, 0), a.cents.totalCommission);
  console.log('PASS: candidate runtime smoke, without a database connection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
