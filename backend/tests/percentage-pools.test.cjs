const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('percentagepools');
const { prisma } = database;
const user = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => next() } };
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const { calculateCommissionForPeriod } = loadTypeScript('src/services/commissionService.ts', stubs);
const { parseCatalogue } = loadTypeScript('src/services/catalogueTransfer.ts');
const { poolContributionAmount } = loadTypeScript('src/utils/poolRates.ts');
const call = (router, method, url, body) => request(router, method, url, { user, body });
let check = 100;
const save = (items, date = '2026-10-20') => call(billsRouter, 'POST', '/', {
  propertyId: 'a', checkNumber: check++, businessDate: date, guestName: 'Guest', roomNumber: '101', items,
});
const line = (id, quantity = 1, unitPrice = 100, discountPercent = 0) => ({ itemId: id, itemName: id, categoryName: 'Services', quantity, unitPrice, discountPercent });
test.before(async () => {
  await prisma.property.create({ data: { id: 'a', name: 'Centre', code: 'A', serviceChargeRate: 10, taxRate: 16 } });
  await prisma.user.create({ data: { id: 'manager', username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
  await prisma.category.create({ data: { id: 'services', propertyId: 'a', name: 'Services' } });
  await prisma.item.createMany({ data: [
    { id: 'course', poolType: 'COURSE_POOL', poolContribution: 10 },
    { id: 'dive', poolType: 'DIVE_POOL', poolContribution: 10 },
    { id: 'cert', poolType: 'CERTIFICATION_POOL', poolContribution: 25 },
    { id: 'media', poolType: 'NONE', poolContribution: 0, includesComplimentaryMedia: true },
  ].map(item => ({ ...item, propertyId: 'a', categoryId: 'services', code: item.id, name: item.id, price: 100 })) });
  await prisma.staffMember.create({ data: { id: 'leader', propertyId: 'a', name: 'Leader', roleTitle: 'Base Leader', hireDate: '2026-01-01', isCoursePoolSharing: true, isDivePoolSharing: true, isBaseLeaderOverride: true } });
  for (const date of ['2026-09-20', '2026-10-20']) {
    await prisma.attendance.create({ data: { propertyId: 'a', staffMemberId: 'leader', date, status: 'PRESENT' } });
    await prisma.bill.create({ data: { propertyId: 'a', checkNumber: check++, businessDate: date, guestName: 'Legacy', roomNumber: '101', createdById: 'manager', items: { create: [
      { itemId: 'course', itemName: 'course', categoryName: 'Services', quantity: 2, unitPrice: 100, discountPercent: 20, lineTotal: 160 },
      { itemId: 'dive', itemName: 'dive', categoryName: 'Services', quantity: 3, unitPrice: 100, discountPercent: 20, lineTotal: 240 },
      { itemId: 'cert', itemName: 'cert', categoryName: 'Services', quantity: 2, unitPrice: 100, lineTotal: 200 },
    ] } } });
  }
  await prisma.monthLock.create({ data: { propertyId: 'a', yearMonth: '2026-09', isLocked: true, lockedById: 'manager' } });
});
test.after(() => database.dispose());
test('migration corrects unlocked history to 10% and preserves locked pool/payroll amounts', async () => {
  const beforeLocked = await calculateCommissionForPeriod('a', '2026-09-01', '2026-09-30');
  assert.equal(beforeLocked.grandTotal, 55);
  const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261030030000_percentage_pools/migration.sql'), 'utf8');
  await prisma.$transaction(async tx => {
    // Recreate the pre-migration table shape within this isolated test schema.
    await tx.$executeRawUnsafe('ALTER TABLE "BillItem" DROP COLUMN "poolTypeSnapshot", DROP COLUMN "poolContributionAmount"');
    for (const statement of sql.split(';').map(value => value.trim()).filter(value => value && !['BEGIN', 'COMMIT'].includes(value))) await tx.$executeRawUnsafe(statement);
  });
  const locked = await calculateCommissionForPeriod('a', '2026-09-01', '2026-09-30');
  assert.deepEqual(locked, beforeLocked);
  const open = await calculateCommissionForPeriod('a', '2026-10-01', '2026-10-31');
  assert.equal(open.staffResults[0].courseCommission, 16);
  assert.equal(open.staffResults[0].diveCommission, 24);
  assert.equal(open.staffResults[0].overrideCommission, 4);
  assert.equal(open.certificationPoolTotal, 50);
  assert.equal(open.grandTotal, 44);
  assert.equal((await prisma.item.findUnique({ where: { id: 'course' } })).poolContribution, 10);
});
test('new bills snapshot percentage pools after discounts and before tax/service charge', async () => {
  const saved = await save([line('course', 2, 200, 25), line('dive', 3, 80, 50)]);
  assert.equal(saved.status, 201);
  const lines = saved.body.bill.items;
  assert.equal(lines.find(item => item.itemId === 'course').lineTotal, 300);
  assert.equal(lines.find(item => item.itemId === 'course').poolContributionAmount, 30);
  assert.equal(lines.find(item => item.itemId === 'dive').poolContributionAmount, 12);
  assert.equal(saved.body.bill.serviceChargeAmount, 42);
  assert.equal(saved.body.bill.taxAmount, 73.92);
  const result = await calculateCommissionForPeriod('a', '2026-10-20', '2026-10-20');
  assert.equal(result.staffResults[0].courseCommission, 46);
  assert.equal(result.staffResults[0].diveCommission, 36);
  assert.equal(result.staffResults[0].overrideCommission, 8.2);
});
test('complimentary course/dive units contribute zero while media payments remain fixed', async () => {
  const saved = await save([line('course', 1, 100, 100), line('dive', 1, 0), { ...line('media', 2, 0), clientLineId: 'media' }, { itemName: 'Photo', categoryName: 'Photo & Video', autoPhotoFor: 'media', quantity: 2, unitPrice: 57.5, photoStaffId: 'leader' }]);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.bill.items.find(item => item.itemId === 'course').poolContributionAmount, 0);
  assert.equal(saved.body.bill.items.find(item => item.itemId === 'dive').poolContributionAmount, 0);
  assert.equal(saved.body.bill.items.find(item => item.autoPhotoForLineId).totalPersonalCommission, 9);
});
test('saved pool amounts survive later catalogue edits and client snapshots are ignored', async () => {
  const saved = await save([{ ...line('course', 1, 200), poolTypeSnapshot: 'NONE', poolContributionAmount: 9999 }]);
  assert.equal(saved.status, 201);
  const stored = saved.body.bill.items[0];
  assert.equal(stored.poolContributionAmount, 20);
  await prisma.item.update({ where: { id: 'course' }, data: { poolContribution: 50, price: 900 } });
  assert.equal((await prisma.billItem.findUnique({ where: { id: stored.id } })).poolContributionAmount, 20);
  const result = await calculateCommissionForPeriod('a', '2026-10-20', '2026-10-20');
  assert.equal(result.staffResults[0].courseCommission, 66);
  assert.equal((await save([line('course')], '2026-09-20')).status, 423);
});
test('course and dive percentages validate to 0–100, default to 10, and certification amounts stay fixed', async () => {
  for (const poolType of ['COURSE_POOL', 'DIVE_POOL']) {
    assert.equal((await call(itemsRouter, 'POST', '/', { propertyId: 'a', categoryId: 'services', name: 'Invalid rate', price: 100, poolType, poolContribution: 101 })).status, 400);
    const created = await call(itemsRouter, 'POST', '/', { propertyId: 'a', categoryId: 'services', name: 'Default rate', price: 100, poolType });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.poolContribution, 10);
    assert.equal((await call(itemsRouter, 'PUT', `/${created.body.item.id}`, { poolContribution: 101 })).status, 400);
  }
  assert.equal(poolContributionAmount('COURSE_POOL', 10, 2, 170), 17);
  assert.equal(poolContributionAmount('DIVE_POOL', 10, 3, 180), 18);
  assert.equal(poolContributionAmount('CERTIFICATION_POOL', 25, 2, 200), 50);
  assert.equal(poolContributionAmount('NONE', 10, 2, 200), 0);
  const invalid = Buffer.from('Item Code,Items,Category,Price,Commission,Status\n,Invalid percentage,Courses,200,101,Active').toString('base64');
  await assert.rejects(parseCatalogue(invalid, 'csv'), /invalid Commission/);
});
