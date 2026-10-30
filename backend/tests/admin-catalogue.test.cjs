const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('admincatalogue');
const prisma = database.prisma;
const manager = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const admin = { ...manager, role: 'GLOBAL_ADMIN' };
const staff = { ...manager, role: 'CENTRE_STAFF' };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) } };
const { staffRouter } = loadTypeScript('src/routes/staff.routes.ts', stubs);
const { usersRouter } = loadTypeScript('src/routes/users.routes.ts', stubs);
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const { propertiesRouter } = loadTypeScript('src/routes/properties.routes.ts', stubs);
const { passwordSchema } = loadTypeScript('src/utils/password.ts');
const { categoryPrefix } = loadTypeScript('src/services/catalogueTransfer.ts');
const call = (router, method, url, body = {}, user = manager) => request(router, method, url, { body, user });
const password = 'LongerThan12!abc123';
const staffBody = (name, leavingDate) => ({ propertyId: 'a', name, roleTitle: 'Instructor', hireDate: '2026-01-01', ...(leavingDate !== undefined ? { leavingDate } : {}) });
const headers = ['Item Code', 'Items', 'Category', 'Price', 'Commission', 'Status'];
async function file(rows, format = 'csv') {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Catalogue');
  sheet.addRows([headers, ...rows]);
  return Buffer.from(format === 'csv' ? await book.csv.writeBuffer() : await book.xlsx.writeBuffer()).toString('base64');
}
const importFile = async (rows, options = {}, user = manager) => call(itemsRouter, 'POST', '/import', { propertyId: 'a', format: 'csv', content: await file(rows), ...options }, user);
const exportFile = (format = 'csv', user = manager, propertyId = 'a') => new Promise((resolve, reject) => {
  const req = { method: 'GET', url: '/export', body: {}, headers: {}, query: { propertyId, format }, user };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, json(body) { resolve({ status: this.statusCode, body }); }, send(bytes) { resolve({ status: this.statusCode, bytes }); } };
  itemsRouter.handle(req, res, error => reject(error || Error('No response')));
});
test.before(async () => {
  await prisma.property.createMany({ data: [{ id: 'a', code: 'A', name: 'Centre A' }, { id: 'b', code: 'B', name: 'Centre B' }] });
  await prisma.user.create({ data: { id: 'manager', username: 'manager', name: 'Manager', passwordHash: 'fixture', role: 'PROPERTY_MANAGER' } });
  await prisma.category.create({ data: { id: 'diving', name: 'Diving', propertyId: 'a' } });
});
test.after(() => database.dispose());
test('password minimum is 12 and existing complexity applies to longer passwords', () => {
  assert(passwordSchema.safeParse('StrongPass1!').success);
  assert(passwordSchema.safeParse(password).success);
  for (const value of ['Short1!', 'longpassword12345!', 'LONGPASSWORD12345!', 'LongPasswordNoSymbol1', 'Long Password1!']) assert(!passwordSchema.safeParse(value).success);
});
test('managers create staff without leaving dates and optionally create a linked scoped login atomically', async () => {
  for (const leaving of ['', null, undefined]) {
    const result = await call(staffRouter, 'POST', '/', staffBody('No login', leaving));
    assert.equal(result.status, 201); assert.equal(result.body.staff.leavingDate, null); assert.equal(result.body.staff.userId, null);
  }
  const body = { ...staffBody('Has login', ''), loginAccess: { username: 'Diver.Login', password, role: 'GLOBAL_ADMIN' } };
  const result = await call(staffRouter, 'POST', '/', body);
  assert.equal(result.status, 201);
  const user = await prisma.user.findUnique({ where: { id: result.body.staff.userId }, include: { assignedProperties: true } });
  assert.equal(user.username, 'diver.login'); assert.equal(user.role, 'CENTRE_STAFF'); assert(user.mustChangePassword);
  assert(await bcrypt.compare(password, user.passwordHash)); assert.deepEqual(user.assignedProperties.map(p => p.propertyId), ['a']);
  assert(!JSON.stringify(result.body).includes(password)); assert(!JSON.stringify(result.body).includes(user.passwordHash));
  const before = await prisma.staffMember.count();
  assert.equal((await call(staffRouter, 'POST', '/', body)).status, 409);
  assert.equal(await prisma.staffMember.count(), before);
  assert.equal((await call(staffRouter, 'POST', '/', { ...body, loginAccess: { username: 'bad-password', password: 'short' } })).status, 400);
  assert.equal(await prisma.staffMember.count(), before);
  assert.equal((await call(staffRouter, 'POST', '/', { ...staffBody('Invalid'), leavingDate: '2025-01-01' })).status, 400);
  assert.equal((await call(staffRouter, 'POST', '/', { ...staffBody('Foreign'), propertyId: 'b' })).status, 403);
  assert.equal((await call(staffRouter, 'POST', '/', staffBody('No permission'), staff)).status, 403);
  assert.equal((await call(staffRouter, 'POST', '/', { ...staffBody('Admin login'), propertyId: 'b', loginAccess: { username: 'admin-created-staff', password } }, admin)).status, 201);
});
test('property managers create login-only users with a longer password and no leaving date', async () => {
  const result = await call(usersRouter, 'POST', '/', { name: 'Login only', username: 'login-only', password, role: 'CENTRE_STAFF', propertyIds: ['a'] });
  assert.equal(result.status, 201);
});
test('only global administrators can assign multiple validated PMS resorts', async () => {
  assert.equal((await call(propertiesRouter, 'PUT', '/a', { pmsPropertyCodes: ['OLHU', 'SSO'] })).status, 403);
  assert.equal((await call(propertiesRouter, 'PUT', '/a', { pmsPropertyCodes: ['OLHU', 'SSO'] }, admin)).status, 200);
  const saved = await prisma.property.findUnique({ where: { id: 'a' } });
  assert.deepEqual(saved.pmsPropertyCodes, ['OLHU', 'SSO']); assert.equal(saved.pmsPropertyCode, 'OLHU');
  for (const codes of [['OLHU', 'OLHU'], ['INVALID']]) assert.equal((await call(propertiesRouter, 'PUT', '/a', { pmsPropertyCodes: codes }, admin)).status, 400);
});
test('item creation generates stable category codes, including concurrent and archived allocations', async () => {
  const data = { propertyId: 'a', categoryId: 'diving', name: 'Boat dive', code: 'CLIENT-CODE', price: 75 };
  const created = await Promise.all(Array.from({ length: 4 }, () => call(itemsRouter, 'POST', '/', data)));
  assert(created.every(result => result.status === 201));
  assert.deepEqual(created.map(result => result.body.item.code).sort(), ['DIV-001', 'DIV-002', 'DIV-003', 'DIV-004']);
  const first = created.find(result => result.body.item.code === 'DIV-004').body.item;
  await call(itemsRouter, 'DELETE', `/${first.id}`);
  assert.equal((await call(itemsRouter, 'POST', '/', data)).body.item.code, 'DIV-005');
  assert.equal((await call(itemsRouter, 'PUT', `/${first.id}`, { code: 'DIV-001' })).status, 400);
  assert.equal(categoryPrefix('Diving'), 'DIV'); assert.equal(categoryPrefix('Équipement'), 'EQU'); assert.equal(categoryPrefix('A'), 'AXX');
});
test('CSV preview is read-only; commit creates categories, generates codes and retains full commissions', async () => {
  const rows = [['', 'Special dive', 'Diving', 99, '{"poolType":"DIVE_POOL","poolContribution":10,"personalRates":{"guide":5}}', 'Active'], ['', 'Open Water', 'Courses', 500, 20, 'Inactive']];
  const before = await prisma.item.count();
  const preview = await importFile(rows);
  assert.equal(preview.status, 200); assert.equal(preview.body.created, 2); assert.equal(preview.body.previewRows[0].name, 'Special dive');
  assert.equal(await prisma.item.count(), before);
  assert.equal(await prisma.category.count({ where: { name: 'Courses' } }), 0);
  const result = await importFile(rows, { preview: false }); assert.equal(result.status, 200);
  const dive = await prisma.item.findFirst({ where: { name: 'Special dive' } });
  assert.equal(dive.code, 'DIV-006'); assert.equal(dive.personalRatesJson, '{"guide":5}');
  const course = await prisma.item.findFirst({ where: { name: 'Open Water' } });
  assert.equal(course.code, 'COU-001'); assert.equal(course.poolType, 'COURSE_POOL'); assert.equal(course.poolContribution, 20); assert.equal(course.isActive, false);
});
test('labelled CSV and Excel exports round-trip all settings; imports update only matching property codes', async () => {
  for (const format of ['csv', 'xlsx']) {
    const exported = await exportFile(format);
    assert.equal(exported.status, 200);
    const result = await call(itemsRouter, 'POST', '/import', { propertyId: 'a', format, content: exported.bytes.toString('base64'), preview: false });
    assert.equal(result.status, 200); assert.equal(result.body.created, 0);
  }
  const updated = await importFile([['DIV-006', 'Updated dive', 'Diving', 80, '{"poolType":"DIVE_POOL","poolContribution":10,"personalRates":{"guide":5}}', 'Inactive']], { preview: false });
  assert.equal(updated.status, 200);
  assert.equal((await prisma.item.findUnique({ where: { propertyId_code: { propertyId: 'a', code: 'DIV-006' } } })).price, 80);
  const before = await prisma.item.count();
  assert.equal((await importFile([['DIV-999', 'Duplicate one', 'Diving', 10, 0, 'Active'], ['DIV-999', 'Duplicate two', 'Diving', 10, 0, 'Active']], { preview: false })).status, 400);
  assert.equal((await importFile([['', 'Foreign', 'Diving', 10, 0, 'Active']], { propertyId: 'b', preview: false })).status, 403);
  assert.equal((await importFile([['', 'No rights', 'Diving', 10, 0, 'Active']], { preview: false }, staff)).status, 403);
  assert.equal((await exportFile('csv', staff)).status, 403);
  assert.equal((await exportFile('csv', manager, 'b')).status, 403);
  assert.equal(await prisma.item.count(), before);
});
test('invalid rows and historical pool changes reject the entire batch without partial writes', async () => {
  const before = await prisma.item.count();
  for (const row of [['', 'Bad price', 'Diving', -1, 0, 'Active'], ['', 'Bad commission', 'Diving', 10, -1, 'Active'], ['', 'Bad status', 'Diving', 10, 0, 'Other']]) {
    assert.equal((await importFile([['', 'Valid row', 'New Category', 10, 0, 'Active'], row], { preview: false })).status, 400);
    assert.equal(await prisma.item.count(), before);
    assert.equal(await prisma.category.count({ where: { name: 'New Category' } }), 0);
  }
  const item = await prisma.item.findUnique({ where: { propertyId_code: { propertyId: 'a', code: 'DIV-006' } } });
  await prisma.bill.create({ data: { propertyId: 'a', createdById: 'manager', checkNumber: 1, businessDate: '2026-10-21', guestName: 'Guest', roomNumber: '101', items: { create: { itemId: item.id, itemName: item.name, categoryName: 'Diving', unitPrice: item.price, lineTotal: item.price } } } });
  assert.equal((await importFile([['', 'New item', 'Diving', 10, 0, 'Active'], ['DIV-006', item.name, 'Diving', 10, 999, 'Active']], { preview: false })).status, 400);
  assert.equal(await prisma.item.count(), before);
});

test('spreadsheet formulas are rejected and formula-like item names remain safe and reversible on export', async () => {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Catalogue');
  sheet.addRow(headers); sheet.addRow(['', 'Formula price', 'Diving', { formula: '1+1', result: 2 }, 0, 'Active']);
  const content = Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
  assert.equal((await call(itemsRouter, 'POST', '/import', { propertyId: 'a', format: 'xlsx', content, preview: false })).status, 400);
  const result = await importFile([['', '=SUM(1,2)', 'Diving', 10, 0, 'Active']], { preview: false });
  assert.equal(result.status, 200);
  const exported = await exportFile('csv');
  assert(exported.bytes.toString().includes("'=SUM(1,2)"));
  assert.equal((await call(itemsRouter, 'POST', '/import', { propertyId: 'a', format: 'csv', content: exported.bytes.toString('base64'), preview: false })).status, 200);
  assert.equal(await prisma.item.count({ where: { name: '=SUM(1,2)' } }), 1);
});

test('CSV and Excel preserve new supplied codes, preview without writes, and update them on reimport', async () => {
  for (const [format, code] of [['csv', '13152'], ['xlsx', '0013153']]) {
    // The same external code in another property must not become an update target.
    const category = await prisma.category.create({ data: { propertyId: 'b', name: `External ${format}` } });
    const foreign = await prisma.item.create({ data: { propertyId: 'b', categoryId: category.id, code, name: 'Other property item', price: 777 } });
    const rows = [[code, `External ${format}`, 'Imported activities', 45, 5, 'Active']];
    const body = { propertyId: 'a', format, content: await file(rows, format) };
    const before = await prisma.item.count();
    const auditBefore = await prisma.auditLog.count();
    const preview = await call(itemsRouter, 'POST', '/import', body);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.created, 1);
    assert.equal(preview.body.updated, 0);
    assert.equal(preview.body.previewRows[0].code, code);
    assert.equal(await prisma.item.count(), before);
    assert.equal(await prisma.auditLog.count(), auditBefore);

    const created = await call(itemsRouter, 'POST', '/import', { ...body, preview: false });
    assert.equal(created.status, 200);
    assert.equal(created.body.created, 1);
    assert.equal(created.body.updated, 0);
    const item = await prisma.item.findUnique({ where: { propertyId_code: { propertyId: 'a', code } } });
    assert(item);
    assert.equal(item.code, code);
    assert.equal(item.price, 45);
    assert.equal(await prisma.auditLog.count({ where: { action: 'ITEM_CREATE', targetId: item.id } }), 1);

    const updatedBody = { ...body, content: await file([[code, 'Reimported item', 'Imported activities', 60, 5, 'Inactive']], format) };
    const updatePreview = await call(itemsRouter, 'POST', '/import', updatedBody);
    assert.equal(updatePreview.body.created, 0);
    assert.equal(updatePreview.body.updated, 1);
    const updated = await call(itemsRouter, 'POST', '/import', { ...updatedBody, preview: false });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.created, 0);
    assert.equal(updated.body.updated, 1);
    const saved = await prisma.item.findUnique({ where: { id: item.id } });
    assert.equal(saved.code, code);
    assert.equal(saved.price, 60);
    assert.equal(saved.isActive, false);
    assert.equal(await prisma.item.count(), before + 1);
    assert.equal(await prisma.auditLog.count({ where: { action: 'ITEM_UPDATE', targetId: item.id } }), 1);
    assert.deepEqual(await prisma.item.findUnique({ where: { id: foreign.id } }), foreign);
  }
});

test('mixed batches count creates and updates correctly and reserve supplied codes before generating blank codes', async () => {
  const rows = [
    ['', 'Generated first', 'Reserved codes', 10, 0, 'Active'],
    ['RES-001', 'Supplied second', 'Reserved codes', 20, 0, 'Active'],
    ['13152', 'Updated existing', 'Imported activities', 70, 5, 'Active'],
  ];
  const preview = await importFile(rows);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.created, 2);
  assert.equal(preview.body.updated, 1);
  assert.equal(preview.body.total, 3);
  const result = await importFile(rows, { preview: false });
  assert.equal(result.status, 200);
  assert.equal(result.body.created, 2);
  assert.equal(result.body.updated, 1);
  assert.equal((await prisma.item.findUnique({ where: { propertyId_code: { propertyId: 'a', code: 'RES-001' } } })).name, 'Supplied second');
  assert.equal((await prisma.item.findUnique({ where: { propertyId_code: { propertyId: 'a', code: 'RES-002' } } })).name, 'Generated first');
  assert.equal((await prisma.item.findUnique({ where: { propertyId_code: { propertyId: 'a', code: '13152' } } })).price, 70);
});
