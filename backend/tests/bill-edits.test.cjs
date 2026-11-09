const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('billedits');
const { prisma } = database;
const auth = { requireAuth: (_req, _res, next) => next() };
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', { '../db': { prisma }, '../middleware/auth': auth });
const { calculateCommissionForPeriod } = loadTypeScript('src/services/commissionService.ts', { '../db': { prisma } });
const actor = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['own'] };
let check = 4000;
const line = (changes = {}) => ({ clientLineId: 'root', itemId: 'dive', itemName: 'Ignored client name', categoryName: 'Ignored', quantity: 1, unitPrice: 100, discountPercent: 0, sellerStaffId: 'employee', ...changes });
const body = (changes = {}) => ({ propertyId: 'own', checkNumber: check++, businessDate: '2026-11-04', guestName: 'Test Guest', roomNumber: '0012', nationality: 'Other', items: [line()], ...changes });
const call = (method, path, body, user = actor, router = billsRouter) => request(router, method, path, { user, body });
const create = async (changes) => { const result = await call('POST', '/', body(changes)); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.bill; };
const correction = (bill, changes = {}) => ({ ...body({ checkNumber: bill.checkNumber, businessDate: bill.businessDate, guestName: bill.guestName, roomNumber: bill.roomNumber, nationality: bill.nationality, tipAmount: bill.tipAmount,
  tipStaffIds: JSON.parse(bill.tipStaffIdsJson || '[]'), items: bill.items.map(row => ({ ...row, sourceLineId: row.id, clientLineId: row.id, autoPhotoFor: row.autoPhotoForLineId })) }), expectedUpdatedAt: bill.updatedAt.toISOString(), editReason: 'Correcting a posted bill', ...changes });
test.before(async () => {
  await prisma.property.createMany({ data: [{ id: 'own', code: 'OWN', name: 'Own', serviceChargeRate: 10, taxRate: 16 }, { id: 'other', code: 'OTHER', name: 'Other' }] });
  await prisma.user.create({ data: { id: 'manager', username: 'bill-manager', name: 'Manager', passwordHash: 'unused' } });
  await prisma.category.create({ data: { id: 'dives', propertyId: 'own', name: 'Dives' } });
  await prisma.staffMember.createMany({ data: [{ id: 'employee', propertyId: 'own', name: 'Employee', roleTitle: 'Instructor', hireDate: '2026-01-01' }, { id: 'foreign', propertyId: 'other', name: 'Other', roleTitle: 'Instructor', hireDate: '2026-01-01' }] });
  await prisma.item.create({ data: { id: 'dive', propertyId: 'own', categoryId: 'dives', code: 'DIVE', name: 'Dive', price: 100, poolType: 'DIVE_POOL', poolContribution: 10, personalRoles: 'seller,instructor', personalRatesJson: '{"seller":10,"instructor":20}' } });
});
test.after(() => database.dispose());

test('managers correct posted bills atomically, retain identity and creator, recalculate amounts and record both versions', async () => {
  const bill = await create();
  const result = await call('PUT', '/' + bill.id, correction(bill, { guestName: 'Corrected Guest', roomNumber: '0013', items: [line({ sourceLineId: bill.items[0].id, quantity: 2, discountPercent: 25 })] }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const saved = result.body.bill;
  assert.equal(saved.id, bill.id); assert.equal(saved.createdById, bill.createdById); assert.equal(saved.checkNumber, bill.checkNumber);
  assert.equal(saved.grossAmount, 200); assert.equal(saved.discountAmount, 50); assert.equal(saved.serviceChargeAmount, 15); assert.equal(saved.taxAmount, 26.4); assert.equal(saved.netAmount, 191.4);
  assert.equal(saved.items[0].totalPersonalCommission, 15); assert.equal(saved.items[0].poolContributionAmount, 15);
  const audit = await prisma.auditLog.findFirst({ where: { targetId: bill.id, action: 'BILL_EDIT' } });
  const detail = JSON.parse(audit.details);
  assert.equal(detail.before.guestName, 'Test Guest'); assert.equal(detail.after.guestName, 'Corrected Guest'); assert.equal(detail.reason, 'Correcting a posted bill');
});
test('staff, unassigned managers, cross-property IDs, missing reasons and stale versions cannot overwrite posted bills', async () => {
  const bill = await create(); const input = correction(bill);
  assert.equal((await call('PUT', '/' + bill.id, input, { ...actor, role: 'CENTRE_STAFF' })).status, 403);
  assert.equal((await call('PUT', '/' + bill.id, input, { ...actor, assignedPropertyIds: ['other'] })).status, 403);
  assert.equal((await call('PUT', '/' + bill.id, { ...input, propertyId: 'other' }, { ...actor, assignedPropertyIds: ['other'] })).status, 404);
  for (const patch of [{ editReason: undefined }, { editReason: 'x' }, { expectedUpdatedAt: undefined }, { expectedUpdatedAt: 'invalid' }, { items: [line({ quantity: '2' })] }]) assert.equal((await call('PUT', '/' + bill.id, { ...input, ...patch })).status, 400);
  assert.equal((await call('PUT', '/' + bill.id, { ...input, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })).status, 409);
  assert.equal((await prisma.bill.findUnique({ where: { id: bill.id } })).updatedAt.toISOString(), bill.updatedAt.toISOString());
});
test('both original and target payroll locks, inactive statuses and duplicate check numbers are enforced', async () => {
  const bill = await create({ businessDate: '2026-10-01' });
  await prisma.monthLock.create({ data: { propertyId: 'own', yearMonth: '2026-10', isLocked: true, lockedById: 'manager' } });
  assert.equal((await call('PUT', '/' + bill.id, correction(bill, { businessDate: '2026-11-04' }))).status, 423);
  await prisma.monthLock.update({ where: { propertyId_yearMonth: { propertyId: 'own', yearMonth: '2026-10' } }, data: { isLocked: false } });
  await prisma.monthLock.create({ data: { propertyId: 'own', yearMonth: '2026-12', isLocked: true, lockedById: 'manager' } });
  assert.equal((await call('PUT', '/' + bill.id, correction(bill, { businessDate: '2026-12-01' }))).status, 423);
  const other = await create();
  assert.equal((await call('PUT', '/' + bill.id, correction(bill, { checkNumber: other.checkNumber }))).status, 400);
  for (const status of ['REBATED', 'DELETED']) { await prisma.bill.update({ where: { id: bill.id }, data: { status } }); assert.equal((await call('PUT', '/' + bill.id, correction(bill))).status, 409); }
});
test('concurrent corrections accept one version and reject the other without losing either edit silently', async () => {
  const bill = await create();
  const results = await Promise.all(['First correction', 'Second correction'].map(notes => call('PUT', '/' + bill.id, correction(bill, { notes }))));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(await prisma.auditLog.count({ where: { targetId: bill.id, action: 'BILL_EDIT' } }), 1);
});
test('a failed audit write rolls back the bill and replaced lines', async () => {
  const bill = await create();
  const wrapped = new Proxy(prisma, { get(target, key) {
    if (key === '$transaction') return (operation, options) => target.$transaction(tx => operation(new Proxy(tx, { get(client, member) { return member === 'auditLog' ? { create: async () => { throw Error('Audit unavailable'); } } : Reflect.get(client, member); } })), options);
    return Reflect.get(target, key);
  } });
  const { billsRouter: failingRouter } = loadTypeScript('src/routes/bills.routes.ts', { '../db': { prisma: wrapped }, '../middleware/auth': auth }, { console: { error: () => {} } });
  assert.equal((await call('PUT', '/' + bill.id, correction(bill, { guestName: 'Must roll back' }), actor, failingRouter)).status, 500);
  const after = await prisma.bill.findUnique({ where: { id: bill.id }, include: { items: true } });
  assert.equal(after.guestName, bill.guestName); assert.equal(after.items[0].id, bill.items[0].id); assert.equal(after.updatedAt.toISOString(), bill.updatedAt.toISOString());
});
test('discounting only one of three product units reduces only that unit commission; 100 percent leaves tips intact', async () => {
  const bill = await create({ businessDate: '2026-11-05', items: [line({ quantity: 2 }), line({ clientLineId: 'discounted', quantity: 1, discountPercent: 20 })] });
  assert.equal(bill.grossAmount, 300); assert.equal(bill.discountAmount, 20);
  assert.equal(bill.items.reduce((sum, row) => sum + row.totalPersonalCommission, 0), 28);
  const report = await calculateCommissionForPeriod('own', '2026-11-05', '2026-11-05');
  assert.equal(report.staffResults.find(staff => staff.staffId === 'employee').personalCommission, 28);
  const free = await create({ businessDate: '2026-11-06', items: [line({ quantity: 3, instructorStaffId: 'employee', discountPercent: 100 })], tipAmount: 5, tipStaffIds: ['employee'] });
  assert.equal(free.netAmount, 5); assert.equal(free.items[0].totalPersonalCommission, 0);
  const freeReport = await calculateCommissionForPeriod('own', '2026-11-06', '2026-11-06');
  assert.equal(freeReport.staffResults.find(staff => staff.staffId === 'employee').personalCommission, 0);
  assert.equal(freeReport.staffResults.find(staff => staff.staffId === 'employee').tipsCommission, 5);
});
test('edits retain saved rates and archived catalogue references, and reject foreign line sources', async () => {
  const bill = await create(); const foreignSource = await create();
  await prisma.item.update({ where: { id: 'dive' }, data: { personalRatesJson: '{"seller":99}', poolContribution: 50, isActive: false } });
  await prisma.property.update({ where: { id: 'own' }, data: { serviceChargeRate: 20, taxRate: 30 } });
  try {
    assert.equal((await call('PUT', '/' + bill.id, correction(bill, { items: [line({ sourceLineId: foreignSource.items[0].id })] }))).status, 400);
    const result = await call('PUT', '/' + bill.id, correction(bill, { items: [line({ sourceLineId: bill.items[0].id, quantity: 2 })] }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const saved = result.body.bill;
    assert.equal(saved.items[0].totalPersonalCommission, 20); assert.equal(saved.items[0].poolContributionAmount, 20);
    assert.equal(saved.serviceChargeAmount, 20); assert.equal(saved.taxAmount, 35.2);
  } finally {
    await prisma.item.update({ where: { id: 'dive' }, data: { personalRatesJson: '{"seller":10,"instructor":20}', poolContribution: 10, isActive: true } });
    await prisma.property.update({ where: { id: 'own' }, data: { serviceChargeRate: 10, taxRate: 16 } });
  }
});
test('legacy saved personal commissions remain unchanged until a bill is explicitly edited', async () => {
  const bill = await prisma.bill.create({ data: { propertyId: 'own', checkNumber: check++, businessDate: '2026-11-07', guestName: 'Historical', roomNumber: '0012', createdById: 'manager', grossAmount: 100, discountAmount: 50, serviceChargeAmount: 0, taxAmount: 0, netAmount: 50,
    items: { create: { itemId: 'dive', itemName: 'Dive', categoryName: 'Dives', quantity: 1, unitPrice: 100, discountPercent: 50, lineTotal: 50, sellerStaffId: 'employee', personalCommissionsJson: '{"seller":10}', totalPersonalCommission: 10 } } } });
  const report = await calculateCommissionForPeriod('own', '2026-11-07', '2026-11-07');
  assert.equal(report.staffResults.find(staff => staff.staffId === 'employee').personalCommission, 10);
});
