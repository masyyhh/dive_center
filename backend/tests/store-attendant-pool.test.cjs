const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('storepool');
const { prisma } = database;
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', {
  '../db': { prisma }, '../middleware/auth': { requireAuth: (_req, _res, next) => next() },
});
const { calculateCommissionForPeriod: calculate } = loadTypeScript('src/services/commissionService.ts', { '../db': { prisma } });
const { generateMonthlyExcelWorkbook } = loadTypeScript('src/services/monthlyExcelWorkbook.ts', { '../db': { prisma } });
const { generateDailyExcelReport } = loadTypeScript('src/services/dailyExcelReport.ts', { '../db': { prisma } });
const user = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['sw', 'other'] };
let check = 8000;
const line = (extra = {}) => ({ clientLineId: 'root', itemId: 'retail', itemName: 'Untrusted', categoryName: 'Untrusted', quantity: 1, unitPrice: 100, discountPercent: 0, ...extra });
const save = async (date, extra = {}) => {
  const result = await request(billsRouter, 'POST', '/', { user, body: { propertyId: 'sw', checkNumber: check++, businessDate: date, guestName: 'Guest', roomNumber: '304', items: [line()], ...extra } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.bill;
};
const report = date => calculate('sw', date, date, 'a');
const edit = async (bill, item) => {
  const result = await request(billsRouter, 'PUT', '/' + bill.id, { user, body: { propertyId: bill.propertyId, checkNumber: bill.checkNumber, businessDate: bill.businessDate, guestName: bill.guestName, roomNumber: bill.roomNumber, expectedUpdatedAt: bill.updatedAt.toISOString(), editReason: 'Correct retail price', items: [line({ sourceLineId: bill.items[0].id, ...item })] } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.bill;
};
test.before(async () => {
  await prisma.property.createMany({ data: [{ id: 'sw', code: 'SW', name: 'Siyam World', serviceChargeRate: 10, taxRate: 16 }, { id: 'other', code: 'OTHER', name: 'Iru Fushi' }] });
  await prisma.user.create({ data: { id: 'manager', username: 'store-manager', name: 'Manager', passwordHash: 'unused' } });
  await prisma.category.createMany({ data: [{ id: 'retailcat', propertyId: 'sw', name: 'Retail' }, { id: 'dives', propertyId: 'sw', name: 'Dives' }, { id: 'foreigncat', propertyId: 'other', name: 'Retail' }] });
  await prisma.item.createMany({ data: [{ id: 'retail', propertyId: 'sw', categoryId: 'retailcat', code: 'CAP', name: 'Cap', price: 100 }, { id: 'dive', propertyId: 'sw', categoryId: 'dives', code: 'DIVE', name: 'Dive', price: 100 }, { id: 'foreign', propertyId: 'other', categoryId: 'foreigncat', code: 'CAP', name: 'Cap', price: 100 }] });
  await prisma.staffMember.createMany({ data: [
    ...['a', 'b'].map(id => ({ id, propertyId: 'sw', name: 'Attendant ' + id, roleTitle: 'Store Attendant', hireDate: '2026-01-01', isDiveStaff: false })),
    { id: 'inactive', propertyId: 'sw', name: 'Inactive', roleTitle: 'Store Attendant', hireDate: '2026-01-01', isActive: false },
    { id: 'future', propertyId: 'sw', name: 'Future', roleTitle: 'Store Attendant', hireDate: '2027-01-01' },
    { id: 'left', propertyId: 'sw', name: 'Left', roleTitle: 'Store Attendant', hireDate: '2026-01-01', leavingDate: '2026-10-31' },
    { id: 'leader', propertyId: 'sw', name: 'Leader', roleTitle: 'Base Leader', hireDate: '2026-01-01' },
    { id: 'foreignstaff', propertyId: 'other', name: 'Foreign', roleTitle: 'Store Attendant', hireDate: '2026-01-01' },
  ] });
});
test.after(() => database.dispose());

test('retail snapshots use discounted item sales, ignore client claims, and share exactly without tax or leader override', async () => {
  const bill = await save('2026-11-01', { items: [line({ quantity: 2, unitPrice: 200, discountPercent: 25, storeAttendantRateSnapshot: 100, storeAttendantPoolAmount: 999 })], checkoutDiscountPercent: 20 });
  assert.equal(bill.items[0].lineTotal, 240);
  assert.equal(bill.items[0].storeAttendantRateSnapshot, 5);
  assert.equal(bill.items[0].storeAttendantPoolAmount, 12);
  assert.equal(bill.items[0].totalPersonalCommission, 12);
  const result = await report('2026-11-01');
  assert.equal(result.storeAttendantPoolTotal, 12);
  assert.equal(result.grandTotal, 12);
  assert.deepEqual(result.personalDetails.map(row => row.amount), [6, 6]);
  assert.equal(result.staffResults.find(row => row.staffId === 'leader').overrideCommission, 0);
  assert.equal(result.breakdownDetails[0].recipientCount, 2);
  assert.equal(result.breakdownDetails[0].amount, 6);
});
test('the automatic pool is restricted to server-owned Siyam World Retail categories', async () => {
  const dive = await save('2026-11-02', { items: [line({ itemId: 'dive', categoryName: 'Retail' })] });
  const foreign = await save('2026-11-02', { propertyId: 'other', items: [line({ itemId: 'foreign' })] });
  for (const bill of [dive, foreign]) assert.equal(bill.items[0].storeAttendantPoolAmount, 0);
  assert.equal((await report('2026-11-02')).grandTotal, 0);
});
test('attendance exclusions and no eligible recipients are accounted for explicitly', async () => {
  for (const [date, ids] of [['2026-11-03', ['a']], ['2026-11-04', ['a', 'b']]]) {
    await prisma.attendance.createMany({ data: ids.map(staffMemberId => ({ propertyId: 'sw', staffMemberId, date, status: 'SICK' })) });
    await save(date);
  }
  const one = await report('2026-11-03');
  assert.equal(one.staffResults.find(row => row.staffId === 'b').personalCommission, 5);
  const none = await report('2026-11-04');
  assert.equal(none.storeAttendantPoolTotal, 5);
  assert.equal(none.unallocatedStoreAttendantPoolTotal, 5);
  assert.equal(none.grandTotal, 0);
});
test('whole-cent sharing reconciles small amounts and complete discounts earn zero', async () => {
  await save('2026-11-05', { items: [line({ unitPrice: .2 })] });
  const result = await report('2026-11-05');
  assert.equal(result.storeAttendantPoolTotal, .01);
  assert.equal(result.staffResults.find(row => row.staffId === 'a').personalCommission, .01);
  assert.equal(result.staffResults.find(row => row.staffId === 'b').personalCommission, 0);
  assert.equal(result.grandTotal, .01);
  const free = await save('2026-11-06', { checkoutDiscountPercent: 100 });
  assert.equal(free.items[0].storeAttendantPoolAmount, 0);
  assert.equal((await report('2026-11-06')).grandTotal, 0);
});
test('legacy bills remain unchanged; corrections retain saved rates even after category changes', async () => {
  const old = await save('2026-11-07');
  await prisma.billItem.update({ where: { id: old.items[0].id }, data: { storeAttendantRateSnapshot: null, storeAttendantPoolAmount: null, totalPersonalCommission: 0 } });
  assert.equal((await report('2026-11-07')).grandTotal, 0);
  assert.equal((await edit(old, { unitPrice: 200 })).items[0].storeAttendantPoolAmount, 0);
  const fresh = await save('2026-11-08');
  await prisma.item.update({ where: { id: 'retail' }, data: { categoryId: 'dives' } });
  try {
    const corrected = await edit(fresh, { unitPrice: 200, discountPercent: 25 });
    assert.equal(corrected.items[0].storeAttendantPoolAmount, 7.5);
    assert.equal((await report('2026-11-08')).grandTotal, 7.5);
  } finally { await prisma.item.update({ where: { id: 'retail' }, data: { categoryId: 'retailcat' } }); }
});
test('rebates and deletions remove shared earnings and invalid partial snapshots are rejected', async () => {
  const bill = await save('2026-11-09');
  await assert.rejects(prisma.billItem.update({ where: { id: bill.items[0].id }, data: { storeAttendantPoolAmount: null } }));
  for (const status of ['REBATED', 'DELETED']) {
    await prisma.bill.update({ where: { id: bill.id }, data: { status } });
    assert.equal((await report('2026-11-09')).grandTotal, 0);
  }
});
test('daily and monthly exports include allocated shares and disclose the unallocated pool', async () => {
  const expected = await calculate('sw', '2026-11-01', '2026-11-30');
  const monthly = new ExcelJS.Workbook();
  await monthly.xlsx.load(await generateMonthlyExcelWorkbook('sw', '2026-11'));
  const sheet = monthly.getWorksheet('Commission, SC');
  assert.equal(sheet.getCell('J14').value, expected.grandTotal);
  assert.equal(sheet.getCell('G20').value, 'Retail (5%)');
  assert.equal(sheet.getCell('J15').value.result, expected.grandTotal);
  let staffTotal;
  sheet.eachRow(row => { if (row.getCell(1).value === 'Total') staffTotal = row; });
  assert.equal(staffTotal.getCell(7).value.result, expected.grandTotal);
  assert.equal(staffTotal.getCell(10).value.result, expected.grandTotal);
  assert.equal(monthly.getWorksheet('Overview').getCell('E23').value, 5);
  const daily = new ExcelJS.Workbook();
  await daily.xlsx.load(await generateDailyExcelReport('sw', '2026-11-04'));
  assert.equal(daily.getWorksheet('Store attendant pool').getCell('B3').value, 5);
});
