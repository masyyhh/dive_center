const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('certifications');
const { prisma } = database;
const manager = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => next() } };
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const { reportsRouter } = loadTypeScript('src/routes/reports.routes.ts', stubs);
const { calculateCommissionForPeriod } = loadTypeScript('src/services/commissionService.ts', stubs);
const excel = loadTypeScript('src/services/excelService.ts', stubs);
const create = body => request(itemsRouter, 'POST', '/', { body, user: manager });
const bill = (propertyId, checkNumber, status, lines, date = '2026-10-20') => prisma.bill.create({ data: {
  propertyId, checkNumber, status, businessDate: date, guestName: 'Guest', roomNumber: '101', createdById: 'manager',
  items: { create: lines.map(([itemId, quantity]) => ({ itemId, itemName: itemId, categoryName: 'Certifications', quantity, unitPrice: 100, lineTotal: 100 * quantity })) },
} });
test.before(async () => {
  await prisma.property.createMany({ data: ['a', 'b', 'removed'].map(id => ({ id, code: id.toUpperCase(), name: id, ...(id === 'removed' ? { deletedAt: new Date() } : {}) })) });
  await prisma.category.create({ data: { id: 'existing-cert', propertyId: 'b', name: 'CERTIFICATIONS', sortOrder: 5 } });
  await prisma.user.create({ data: { id: 'manager', username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
});
test.after(() => database.dispose());
test('category migration backfills existing properties without duplicates or historical changes', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261030010000_certifications_category/migration.sql'), 'utf8');
  await prisma.$executeRawUnsafe(sql);
  await prisma.$executeRawUnsafe(sql);
  assert.equal(await prisma.category.count({ where: { propertyId: 'a', name: 'Certifications' } }), 1);
  assert.equal(await prisma.category.count({ where: { propertyId: 'b' } }), 1);
  assert.equal(await prisma.category.count({ where: { propertyId: 'removed' } }), 0);
});
test('certifications pool tracks quantities but pays no staff or base-leader commission', async () => {
  const category = await prisma.category.findFirst({ where: { propertyId: 'a', name: 'Certifications' } });
  const created = await create({ propertyId: 'a', categoryId: category.id, name: 'Certification fee', price: 100, poolType: 'CERTIFICATION_POOL', poolContribution: 25 });
  assert.equal(created.status, 201);
  const certification = created.body.item;
  await prisma.item.createMany({ data: [
    { id: 'course', propertyId: 'a', categoryId: category.id, name: 'Course', code: 'COURSE', price: 100, poolType: 'COURSE_POOL', poolContribution: 40 },
    { id: 'dive', propertyId: 'a', categoryId: category.id, name: 'Dive', code: 'DIVE', price: 100, poolType: 'DIVE_POOL', poolContribution: 20 },
  ] });
  for (const id of ['leader', 'instructor']) {
    await prisma.staffMember.create({ data: { id, propertyId: 'a', name: id, roleTitle: 'Instructor', hireDate: '2026-01-01', isCoursePoolSharing: true, isDivePoolSharing: true, isBaseLeaderOverride: id === 'leader' } });
    await prisma.attendance.create({ data: { propertyId: 'a', staffMemberId: id, date: '2026-10-20', status: 'PRESENT' } });
  }
  await bill('a', 1, 'ACTIVE', [[certification.id, 3], ['course', 1], ['dive', 1]]);
  await bill('a', 2, 'REBATED', [[certification.id, 100]]);
  await bill('a', 3, 'DELETED', [[certification.id, 100]]);
  await bill('a', 4, 'ACTIVE', [[certification.id, 100]], '2026-09-01');
  const result = await calculateCommissionForPeriod('a', '2026-10-01', '2026-10-31');
  assert.equal(result.certificationPoolTotal, 75);
  assert.equal(result.grandTotal, 66);
  const leader = result.staffResults.find(staff => staff.staffId === 'leader');
  assert.equal(leader.overrideCommission, 6);
  assert.equal(leader.totalCommission, 36);
  assert.equal(result.staffResults.find(staff => staff.staffId === 'instructor').totalCommission, 30);
  const otherProperty = await calculateCommissionForPeriod('b', '2026-10-01', '2026-10-31');
  assert.equal(otherProperty.certificationPoolTotal, 0);
  const edited = await request(itemsRouter, 'PUT', `/${certification.id}`, { body: { poolType: 'DIVE_POOL' }, user: manager });
  assert.equal(edited.status, 409);
  const dashboard = await request(reportsRouter, 'GET', '/dashboard', { query: { propertyId: 'a', startDate: '2026-10-01', endDate: '2026-10-31' }, user: manager });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.headline.certificationPoolTotal, 75);
  assert.equal(dashboard.body.headline.totalCommission, 66);
});
test('daily and monthly workbooks report certification amounts separately from staff payroll', async () => {
  const daily = new ExcelJS.Workbook();
  await daily.xlsx.load(await excel.generateDailyExcelReport('a', '2026-10-20'));
  assert.equal(daily.getWorksheet('Certifications Pool').getCell('B2').value, '75.00');
  const monthly = new ExcelJS.Workbook();
  await monthly.xlsx.load(await excel.generateMonthlyExcelWorkbook('a', '2026-10'));
  const rows = monthly.getWorksheet('Overview').getSheetValues().filter(Boolean).map(row => row.slice(1));
  assert(rows.some(row => row[0] === 'Certifications Pool (not paid to staff)' && row[1] === 'USD 75.00'));
  assert(rows.some(row => row[0] === 'Total Staff Commission' && row[1] === 'USD 66.00'));
});
