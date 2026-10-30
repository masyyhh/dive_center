const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('payrollbreakdown');
const { prisma } = database;
const user = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) } };
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { reportsRouter } = loadTypeScript('src/routes/reports.routes.ts', stubs);
const date = '2026-10-20';
const query = { propertyId: 'a', staffId: 'instructor', startDate: date, endDate: date };
const breakdown = (patch = {}, actor = user) => request(reportsRouter, 'GET', '/commission-breakdown', { query: { ...query, ...patch }, user: actor });
test.before(async () => {
  await prisma.property.createMany({ data: ['a', 'b'].map(id => ({ id, code: id, name: id })) });
  await prisma.user.create({ data: { id: 'manager', username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
  await prisma.category.create({ data: { id: 'services', propertyId: 'a', name: 'Services' } });
  await prisma.item.createMany({ data: [
    { id: 'course', poolType: 'COURSE_POOL', poolContribution: 10 },
    { id: 'dive', poolType: 'DIVE_POOL', poolContribution: 10 },
    { id: 'media', poolType: 'NONE', poolContribution: 0, includesComplimentaryMedia: true },
    { id: 'cert', poolType: 'CERTIFICATION_POOL', poolContribution: 20 },
  ].map(item => ({ ...item, propertyId: 'a', categoryId: 'services', code: item.id, name: item.id, price: 100 })) });
  for (const id of ['leader', 'instructor', 'divemaster']) {
    await prisma.staffMember.create({ data: { id, propertyId: 'a', name: id, roleTitle: id, hireDate: '2026-01-01', isCoursePoolSharing: id !== 'divemaster', isDivePoolSharing: true, isBaseLeaderOverride: id === 'leader' } });
    await prisma.attendance.create({ data: { propertyId: 'a', staffMemberId: id, date, status: 'PRESENT' } });
  }
  await prisma.staffMember.create({ data: { id: 'foreign', propertyId: 'b', name: 'Foreign', roleTitle: 'Instructor', hireDate: '2026-01-01' } });
  const line = (id, quantity, unitPrice, discountPercent = 0) => ({ itemId: id, itemName: id, categoryName: 'Services', quantity, unitPrice, discountPercent });
  const result = await request(billsRouter, 'POST', '/', { user, body: { propertyId: 'a', checkNumber: 100, businessDate: date, guestName: 'Guest', roomNumber: '101', tipAmount: 12, tipStaffIds: ['leader', 'instructor'], items: [
    line('course', 2, 100, 25), line('dive', 1, 100), line('dive', 1, 10),
    { ...line('media', 2, 0), clientLineId: 'media' }, { itemName: 'Photo', categoryName: 'Photo & Video', autoPhotoFor: 'media', quantity: 2, unitPrice: 57.5, photoStaffId: 'instructor' }, line('cert', 1, 100),
  ] } });
  assert.equal(result.status, 201);
});
test.after(() => database.dispose());
test('employee breakdown traces actual pool shares, tips and fixed media payments to the bill/service', async () => {
  const result = await breakdown(); assert.equal(result.status, 200);
  const { staff, details, roundingAdjustment } = result.body;
  assert.equal(staff.totalCommission, 26.17);
  assert.equal(roundingAdjustment, 0.01);
  assert(details.every(detail => detail.checkNumber === 100 && detail.billId && detail.businessDate === date));
  assert.equal(details.find(detail => detail.kind === 'COURSE_POOL').amount, 7.5);
  assert.equal(details.filter(detail => detail.kind === 'DIVE_POOL').length, 2);
  assert(details.filter(detail => detail.kind === 'DIVE_POOL').every(detail => detail.recipientCount === 3));
  const media = details.find(detail => detail.kind === 'PERSONAL');
  assert.equal(media.amount, 9); assert.equal(media.unitRate, 4.5); assert.equal(media.quantity, 2);
  assert.equal(details.find(detail => detail.kind === 'TIPS').amount, 6);
  assert(!details.some(detail => detail.itemName === 'cert'));
  const sum = details.reduce((sum, detail) => sum + Math.round(detail.amount * 100) / 100, 0);
  assert(Math.abs(sum + roundingAdjustment - staff.totalCommission) < 1e-9);
});
test('base-leader override is traced to pool services and excludes certifications', async () => {
  const { body } = await breakdown({ staffId: 'leader' });
  assert.equal(body.staff.totalCommission, 19.77);
  const overrides = body.details.filter(detail => detail.kind === 'OVERRIDE');
  assert.equal(overrides.length, 3);
  assert.equal(overrides.reduce((sum, detail) => sum + detail.amount, 0), 2.6);
  assert(overrides.every(detail => detail.factor === 0.1));
});
test('breakdown respects authentication, property boundaries, employee ownership and date validation', async () => {
  assert.equal((await breakdown({}, null)).status, 401);
  assert.equal((await breakdown({ propertyId: 'b' })).status, 403);
  assert.equal((await breakdown({ staffId: 'foreign' })).status, 404);
  assert.equal((await breakdown({ startDate: '2026-02-30' })).status, 400);
  assert.equal((await breakdown({ startDate: '2026-10-21' })).status, 400);
});
test('attendance exclusions remove personal payments, pool shares and tip credit from the breakdown', async () => {
  await prisma.attendance.update({ where: { propertyId_staffMemberId_date: { propertyId: 'a', staffMemberId: 'instructor', date } }, data: { status: 'ABSENT' } });
  const { body } = await breakdown();
  assert.equal(body.staff.totalCommission, 0); assert.deepEqual(body.details, []);
  const leader = (await breakdown({ staffId: 'leader' })).body;
  assert.equal(leader.details.find(detail => detail.kind === 'TIPS').amount, 12);
});
test('rounding adjustments reconcile exactly to the amounts displayed by the money formatter', async () => {
  await prisma.staffMember.create({ data: { id: 'rounding', propertyId: 'a', name: 'Rounding', roleTitle: 'Seller', hireDate: '2026-01-01' } });
  await prisma.item.create({ data: { id: 'fraction', propertyId: 'a', categoryId: 'services', code: 'FRACTION', name: 'Fractional payment', price: 0, personalRatesJson: '{"seller":1.005}' } });
  const saved = await request(billsRouter, 'POST', '/', { user, body: { propertyId: 'a', checkNumber: 101, businessDate: date, guestName: 'Guest', roomNumber: '101', items: [{ itemId: 'fraction', itemName: 'Fractional payment', categoryName: 'Services', quantity: 1, unitPrice: 0, sellerStaffId: 'rounding' }] } });
  assert.equal(saved.status, 201);
  const result = (await breakdown({ staffId: 'rounding' })).body;
  const displayedSum = result.details.reduce((sum, detail) => sum + Number(detail.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })), 0);
  assert(Math.abs(displayedSum + result.roundingAdjustment - result.staff.totalCommission) < 1e-9);
});
