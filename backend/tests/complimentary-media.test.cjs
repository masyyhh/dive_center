const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('complimentarymedia');
const { prisma } = database;
const user = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => next() } };
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { calculateCommissionForPeriod } = loadTypeScript('src/services/commissionService.ts', stubs);
test.before(async () => {
  await prisma.property.create({ data: { id: 'a', name: 'Centre', code: 'A' } });
  await prisma.user.create({ data: { id: 'manager', username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
  await prisma.staffMember.create({ data: { id: 'employee', propertyId: 'a', name: 'Employee', roleTitle: 'Photographer', hireDate: '2026-01-01' } });
  await prisma.category.create({ data: { id: 'services', propertyId: 'a', name: 'Services' } });
  await prisma.item.createMany({ data: ['photo', 'video'].map(role => ({ id: role, propertyId: 'a', categoryId: 'services', code: role, name: `Complimentary ${role}`, price: 0, poolType: 'NONE', personalRoles: role, personalRatesJson: JSON.stringify({ [role]: 4.5 }) })) });
});
test.after(() => database.dispose());
let checkNumber = 100;
async function save(role, quantity, assigned, discountPercent = 0, unitPrice = 0) {
  const included = (await prisma.item.findUnique({ where: { id: role } })).includesComplimentaryMedia;
  return request(billsRouter, 'POST', '/', { user, body: {
    propertyId: 'a', checkNumber: checkNumber++, businessDate: '2026-10-30', guestName: 'Guest', roomNumber: '101',
    items: [{ clientLineId: 'activity', itemId: role, itemName: 'Untrusted label', categoryName: 'Services', quantity, unitPrice, discountPercent,
      ...(!included && assigned ? { [`${role}StaffId`]: 'employee' } : {}), personalCommissionsJson: JSON.stringify({ [role]: 999 }), totalPersonalCommission: 999 }, ...(included ? [{ autoPhotoFor: 'activity', itemName: 'Photo', categoryName: 'Photo & Video', quantity, unitPrice: 57.5, discountPercent: 0, ...(assigned ? { photoStaffId: 'employee' } : {}) }] : [])],
  } });
}
test('selected media employee earns the catalogue rate on a zero-price complimentary service', async () => {
  for (const role of ['photo', 'video']) {
    const result = await save(role, 2, true);
    assert.equal(result.status, 201);
    const line = result.body.bill.items[0];
    assert.equal(line.lineTotal, 0);
    assert.equal(line.totalPersonalCommission, 9);
    assert.deepEqual(JSON.parse(line.personalCommissionsJson), { [role]: 4.5 });
  }
  const payroll = await calculateCommissionForPeriod('a', '2026-10-30', '2026-10-30');
  assert.equal(payroll.staffResults[0].personalCommission, 18);
  assert.equal(payroll.personalDetails.filter(detail => detail.amount === 9).length, 2);
});
test('a fully discounted service still pays the fixed rate and an unassigned service pays nothing', async () => {
  const discounted = await save('photo', 1, true, 100, 100);
  assert.equal(discounted.status, 201);
  assert.equal(discounted.body.bill.items[0].lineTotal, 0);
  assert.equal(discounted.body.bill.items[0].totalPersonalCommission, 4.5);
  const unassigned = await save('video', 1, false);
  assert.equal(unassigned.status, 201);
  assert.equal(unassigned.body.bill.items[0].totalPersonalCommission, 0);
  const payroll = await calculateCommissionForPeriod('a', '2026-10-30', '2026-10-30');
  assert.equal(payroll.grandTotal, 22.5);
});

const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const edit = (id, body, actor = user) => request(itemsRouter, 'PUT', `/${id}`, { user: actor, body });
test('only property managers and administrators with property access can tick catalogue services', async () => {
  assert.equal((await edit('photo', { includesComplimentaryMedia: true }, { ...user, role: 'CENTRE_STAFF' })).status, 403);
  assert.equal((await edit('photo', { includesComplimentaryMedia: true }, { ...user, assignedPropertyIds: ['other'] })).status, 403);
  assert.equal((await edit('photo', { includesComplimentaryMedia: 'yes' })).status, 400);
  assert.equal((await edit('photo', { includesComplimentaryMedia: true })).status, 200);
  assert.equal((await prisma.item.findUnique({ where: { id: 'photo' } })).includesComplimentaryMedia, true);
  assert.equal((await edit('photo', { price: 20 })).status, 200);
  assert.equal((await prisma.item.findUnique({ where: { id: 'photo' } })).includesComplimentaryMedia, true);
});
test('checked services enforce one $4.50 payment per unit regardless of stored or client photo/video rates', async () => {
  await edit('photo', { personalRatesJson: '{"photo":99,"video":99}' });
  const result = await save('photo', 2, true);
  assert.equal(result.status, 201);
  const parent = result.body.bill.items[0];
  const line = result.body.bill.items[1];
  assert.equal(parent.includesComplimentaryMedia, true);
  assert.equal(parent.totalPersonalCommission, 0);
  assert.equal(line.autoPhotoForLineId, parent.id);
  assert.equal(line.unitPrice, 57.5);
  assert.equal(line.quantity, 2);
  assert.equal(result.body.bill.grossAmount, 115);
  assert.equal(line.totalPersonalCommission, 9);
  assert.deepEqual(JSON.parse(line.personalCommissionsJson), { photo: 4.5 });
  assert.equal(line.videoStaffId, null);
  const duplicate = await request(billsRouter, 'POST', '/', { user, body: {
    propertyId: 'a', checkNumber: checkNumber++, businessDate: '2026-10-30', guestName: 'Guest', roomNumber: '101',
    items: [{ itemId: 'photo', itemName: 'Photo', categoryName: 'Services', quantity: 1, unitPrice: 0, photoStaffId: 'employee', videoStaffId: 'employee' }],
  } });
  assert.equal(duplicate.status, 400);
  const unassigned = await save('photo', 1, false);
  assert.equal(unassigned.status, 201);
  assert.equal(unassigned.body.bill.items[0].totalPersonalCommission, 0);
  await edit('photo', { includesComplimentaryMedia: false, personalRatesJson: '{"photo":7}' });
  const saved = await prisma.billItem.findUnique({ where: { id: line.id } });
  assert.equal(saved.includesComplimentaryMedia, false);
  assert.equal(saved.totalPersonalCommission, 9);
  const payroll = await calculateCommissionForPeriod('a', '2026-10-30', '2026-10-30');
  assert(payroll.personalDetails.some(detail => detail.id === `${line.id}-photo` && detail.role === 'Photo' && detail.amount === 9));
  const next = await save('photo', 1, true);
  assert.equal(next.body.bill.items[0].includesComplimentaryMedia, false);
  assert.equal(next.body.bill.items[0].totalPersonalCommission, 7);
});
test('catalogue CSV import/export round-trips the checkbox and older imports preserve it', async () => {
  const ExcelJS = require('exceljs');
  const { commissionCell } = loadTypeScript('src/services/catalogueTransfer.ts');
  const item = await prisma.item.findUnique({ where: { id: 'photo' } });
  async function importFlag(flag, preview = false) {
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Catalogue');
    sheet.addRow(['Item Code', 'Items', 'Category', 'Price', 'Commission', 'Status']);
    sheet.addRow(['photo', 'Complimentary photo', 'Services', 0, commissionCell({ ...item, includesComplimentaryMedia: flag }), 'Active']);
    return request(itemsRouter, 'POST', '/import', { user, body: { propertyId: 'a', format: 'csv', preview, content: Buffer.from(await book.csv.writeBuffer()).toString('base64') } });
  }
  assert.equal((await importFlag(true)).status, 200);
  assert.equal((await prisma.item.findUnique({ where: { id: 'photo' } })).includesComplimentaryMedia, true);
  const review = await importFlag(undefined, true);
  assert.equal(review.status, 200);
  assert.equal(review.body.previewRows[0].action, 'update');
  assert.equal(review.body.previewRows[0].commission.includesComplimentaryMedia, true);
  assert.equal((await importFlag(undefined)).status, 200);
  assert.equal((await prisma.item.findUnique({ where: { id: 'photo' } })).includesComplimentaryMedia, true);
  assert.equal((await importFlag(false)).status, 200);
  assert.equal((await prisma.item.findUnique({ where: { id: 'photo' } })).includesComplimentaryMedia, false);
});

test('automatic Photo adds to the activity, receives normal charges and keeps employee payment off the parent', async () => {
  await prisma.item.update({ where: { id: 'photo' }, data: { includesComplimentaryMedia: true, poolType: 'DIVE_POOL', poolContribution: 10, personalRatesJson: '{"seller":5,"photo":99,"video":99}' } });
  await prisma.property.update({ where: { id: 'a' }, data: { serviceChargeRate: 10, taxRate: 16 } });
  const result = await save('photo', 2, true, 25, 100);
  assert.equal(result.status, 201);
  const { bill } = result.body;
  assert.equal(bill.grossAmount, 315); assert.equal(bill.discountAmount, 50);
  assert.equal(bill.serviceChargeAmount, 26.5); assert.equal(bill.taxAmount, 46.64); assert.equal(bill.netAmount, 338.14);
  assert.equal(bill.items[0].poolContributionAmount, 15);
  assert.equal(bill.items[0].totalPersonalCommission, 0);
  assert.equal(bill.items[1].poolContributionAmount, 0);
  assert.equal(bill.items[1].totalPersonalCommission, 9);
  assert.deepEqual(bill.items.map(line => line.linePosition), [0, 1]);
  const detail = await request(billsRouter, 'GET', `/${bill.id}`, { user });
  assert.equal(detail.status, 200); assert.equal(detail.body.bill.items[1].autoPhotoForLineId, bill.items[0].id);
});

test('invalid Photo links, extra assignments and changed fees reject the entire bill', async () => {
  const parent = { clientLineId: 'parent', itemId: 'photo', itemName: 'Activity', categoryName: 'Services', quantity: 2, unitPrice: 100 };
  const photo = { clientLineId: 'child', autoPhotoFor: 'parent', itemName: 'Photo', categoryName: 'Photo & Video', quantity: 2, unitPrice: 57.5, photoStaffId: 'employee' };
  const count = await prisma.bill.count();
  for (const items of [ [parent], [photo], [parent, { ...photo, autoPhotoFor: 'unknown' }], [parent, { ...photo, quantity: 1 }], [parent, { ...photo, unitPrice: 0 }], [parent, photo, { ...photo, clientLineId: 'duplicate' }], [parent, { ...photo, videoStaffId: 'employee' }], [{ ...parent, photoStaffId: 'employee' }, photo], [parent, { ...photo, itemId: 'video' }], [parent, { ...photo, photoStaffId: 'foreign' }] ]) {
    const result = await request(billsRouter, 'POST', '/', { user, body: { propertyId: 'a', checkNumber: checkNumber++, businessDate: '2026-10-30', guestName: 'Guest', roomNumber: '101', items } });
    assert.equal(result.status, 400, JSON.stringify(items));
  }
  assert.equal(await prisma.bill.count(), count);
});

test('attendance eligibility also applies to the separately selected photographer', async () => {
  await prisma.attendance.create({ data: { propertyId: 'a', staffMemberId: 'employee', date: '2026-10-30', status: 'ABSENT' } });
  const rejected = await save('photo', 1, true, 0, 100);
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /attendance/);
  const unassigned = await save('photo', 1, false, 0, 100);
  assert.equal(unassigned.status, 201); assert.equal(unassigned.body.bill.items[1].totalPersonalCommission, 0);
  await prisma.attendance.deleteMany({ where: { staffMemberId: 'employee' } });
});
