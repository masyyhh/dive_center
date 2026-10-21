const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');

// Every integration suite uses its own schema in the explicit test-only PostgreSQL database.
const { createTestDatabase } = require('./helpers/postgres.cjs');
const testDatabase = createTestDatabase('security');
const prisma = testDatabase.prisma;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-security-'));
const secret = randomBytes(48).toString('hex');
process.env.JWT_SECRET = secret;
delete process.env.JWT_SECRET_FILE;
const actor = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) }, '../services/auditService': { logAuditEvent: async () => {} } };
const { auditRouter } = loadTypeScript('src/routes/audit.routes.ts', stubs);
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { presenceRouter } = loadTypeScript('src/routes/presence.routes.ts', stubs);
const billBody = { propertyId: 'a', checkNumber: 1, businessDate: '2026-10-20', guestName: 'Fixture guest', roomNumber: '101', items: [{ itemId: 'item-a', itemName: 'Tampered label', categoryName: 'Courses', quantity: 1, unitPrice: 50, sellerStaffId: 'staff-a', personalCommissionsJson: '{"seller":999999}', totalPersonalCommission: 999999 }] };

test.before(async () => {
  await prisma.property.createMany({ data: [{ id: 'a', code: 'A', name: 'Fixture A' }, { id: 'b', code: 'B', name: 'Fixture B' }] });
  await prisma.user.create({ data: { id: actor.id, username: 'fixture@example.test', email: 'fixture@example.test', name: 'Manager', passwordHash: 'fixture-hash', role: actor.role, authenticator: { create: { enrolledAt: new Date(), secretCiphertext: 'fixture' } }, assignedProperties: { create: { propertyId: 'a' } } } });
  await prisma.staffMember.createMany({ data: ['a', 'b'].map(id => ({ id: `staff-${id}`, propertyId: id, name: `Private ${id}`, roleTitle: 'Instructor', hireDate: '2026-01-01' })) });
  await prisma.category.createMany({ data: ['a', 'b'].map(id => ({ id: `cat-${id}`, propertyId: id, name: `Category ${id}` })) });
  await prisma.item.createMany({ data: ['a', 'b'].map(id => ({ id: `item-${id}`, propertyId: id, categoryId: `cat-${id}`, name: `Item ${id}`, code: 'DIVE', price: 50, personalRoles: 'seller', personalRatesJson: '{"seller":10}', poolType: 'DIVE_POOL', poolContribution: 5 })) });
  await prisma.auditLog.createMany({ data: ['a', 'b'].map(propertyId => ({ propertyId, action: 'FIXTURE', targetType: 'Fixture' })) });
});
test.after(async () => { await testDatabase.dispose(); fs.rmSync(temp, { recursive: true, force: true }); });

test('audit rejects omitted/ambiguous tenant selectors and keeps legitimate manager/global queries', async () => {
  assert.equal((await request(auditRouter, 'GET', '/', { user: actor, headers: { 'x-property-id': 'a' } })).status, 400);
  const own = await request(auditRouter, 'GET', '/', { user: actor, query: { propertyId: 'a' }, headers: { 'x-property-id': 'b' } });
  assert.equal(own.status, 200);
  assert.equal(own.body.logs.every(log => log.propertyId === 'a'), true);
  assert.equal((await request(auditRouter, 'GET', '/', { user: actor, query: { propertyId: 'b' } })).status, 403);
  assert.equal((await request(auditRouter, 'GET', '/', { user: actor, query: { propertyId: ['a', 'b'] } })).status, 400);
  const global = await request(auditRouter, 'GET', '/', { user: { ...actor, role: 'GLOBAL_ADMIN' } });
  assert.equal(global.body.logs.length, 2);
});
test('catalogue create/update reject foreign categories and allow own category', async () => {
  const body = { propertyId: 'a', categoryId: 'cat-b', code: 'BAD', name: 'Injected', price: 25 };
  assert.equal((await request(itemsRouter, 'POST', '/', { user: actor, body })).status, 400);
  assert.equal((await request(itemsRouter, 'PUT', '/item-a', { user: actor, body: { categoryId: 'cat-b' } })).status, 400);
  assert.equal((await request(itemsRouter, 'POST', '/', { user: actor, body: { ...body, categoryId: 'cat-a', code: 'GOOD' } })).status, 201);
});
test('staff bill commissions and identity are derived from server catalogue while editable pricing remains', async () => {
  const result = await request(billsRouter, 'POST', '/', { user: { ...actor, role: 'CENTRE_STAFF' }, body: billBody });
  assert.equal(result.status, 201);
  const line = result.body.bill.items[0];
  assert.equal(JSON.parse(line.personalCommissionsJson).seller, 10);
  assert.equal(line.itemName, 'Item a');
  assert.equal(line.categoryName, 'Category a');
  assert.equal(line.totalPersonalCommission, 10);
  assert.equal(line.unitPrice, 50);
});
test('all foreign item/staff references and duplicate tips are rejected without creating bills', async () => {
  const initial = await prisma.bill.count();
  for (const patch of [{ itemId: 'item-b' }, { itemId: null }, { sellerStaffId: 'staff-b' }, { guideStaffId: 'staff-b' }, { instructorStaffId: 'staff-b' }, { photoStaffId: 'staff-b' }, { videoStaffId: 'staff-b' }]) {
    assert.equal((await request(billsRouter, 'POST', '/', { user: actor, body: { ...billBody, checkNumber: 2, items: [{ ...billBody.items[0], ...patch }] } })).status, 400, JSON.stringify(patch));
  }
  for (const tipStaffIds of [['staff-b'], ['staff-a', 'staff-a']]) assert.equal((await request(billsRouter, 'POST', '/', { user: actor, body: { ...billBody, checkNumber: 2, tipStaffIds } })).status, 400);
  assert.equal(await prisma.bill.count(), initial);
});
test('attendance rejects foreign, duplicate and ineligible staff without writes; own roster still saves', async () => {
  for (const ids of [['staff-b'], ['staff-a', 'staff-a']]) assert.equal((await request(presenceRouter, 'POST', '/day', { user: actor, body: { propertyId: 'a', date: '2026-10-20', records: ids.map(staffMemberId => ({ staffMemberId, status: 'PRESENT' })) } })).status, 400);
  assert.equal(await prisma.attendance.count(), 0);
  assert.equal((await request(presenceRouter, 'POST', '/day', { user: actor, body: { propertyId: 'a', date: '2026-10-20', records: [{ staffMemberId: 'staff-a', status: 'PRESENT' }] } })).status, 200);
});
test('existing corrupt relations are hidden from catalogue, bill details and monthly workbook', async () => {
  await prisma.item.create({ data: { id: 'corrupt', propertyId: 'a', categoryId: 'cat-b', name: 'Bad relation', code: 'CORRUPT', price: 1 } });
  assert.equal((await request(itemsRouter, 'PUT', '/corrupt', { user: actor, body: { name: 'Changed' } })).status, 400);
  const catalogue = await request(itemsRouter, 'GET', '/', { user: actor, query: { propertyId: 'a' } });
  assert.equal(catalogue.body.items.some(item => item.id === 'corrupt'), false);
  const bill = await prisma.bill.findFirst({ where: { propertyId: 'a' } });
  await prisma.billItem.updateMany({ where: { billId: bill.id }, data: { guideStaffId: 'staff-b' } });
  const detail = await request(billsRouter, 'GET', `/${bill.id}`, { user: actor });
  assert.equal(detail.body.bill.items[0].guideStaff, null);
  await prisma.attendance.create({ data: { propertyId: 'a', staffMemberId: 'staff-b', date: '2026-10-20' } });
  const { generateMonthlyExcelWorkbook } = loadTypeScript('src/services/excelService.ts', { '../db': { prisma } });
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await generateMonthlyExcelWorkbook('a', '2026-10'));
  const names = [];
  workbook.getWorksheet('Attendance Register').eachRow((row, index) => { if (index > 1) names.push(row.getCell(2).value); });
  assert.deepEqual(names, ['Private a']);
});

test('password reset invalidates old tokens, rejects legacy/invalid JWT claims, and new credentials work', async () => {
  const auth = loadTypeScript('src/middleware/auth.ts', { '../db': { prisma } });
  const payload = { id: actor.id, email: 'fixture@example.test', role: actor.role, passwordHash: 'fixture-hash' };
  const token = auth.signToken(payload);
  const authorize = async value => {
    let allowed = false, status = 200;
    await auth.requireAuth({ headers: { authorization: `Bearer ${value}` } }, { status(code) { status = code; return this; }, json() {} }, () => { allowed = true; });
    return { allowed, status };
  };
  assert.equal((await authorize(token)).allowed, true);
  const { usersRouter } = loadTypeScript('src/routes/users.routes.ts', stubs);
  const reset = await request(usersRouter, 'POST', '/manager/reset-password', { user: { ...actor, role: 'GLOBAL_ADMIN' }, body: { password: 'NewPass1!abc' } });
  assert.equal(reset.status, 200);
  assert.equal((await authorize(token)).status, 401);
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  assert.equal((await authorize(auth.signToken({ ...payload, passwordHash: user.passwordHash }))).status, 403);
  await prisma.user.update({ where: { id: actor.id }, data: { mustChangePassword: false } });
  assert.equal((await authorize(auth.signToken({ ...payload, passwordHash: user.passwordHash }))).allowed, true);
  for (const credential of [undefined, 123, 'short', '0'.repeat(64)]) {
    const forged = jwt.sign({ id: actor.id, credential }, secret, { algorithm: 'HS256' });
    assert.equal((await authorize(forged)).status, 401);
  }
  assert.equal((await authorize(jwt.sign({ id: actor.id }, secret, { algorithm: 'HS384' }))).status, 401);
});
test('missing and default signing keys fail closed', () => {
  const { loadJwtSecret } = loadTypeScript('src/config/secrets.ts');
  for (const JWT_SECRET of ['', 'short', 'dive-center-default-secret-change-in-prod', 'example'.repeat(20)]) assert.throws(() => loadJwtSecret({ JWT_SECRET }));
  assert.equal(loadJwtSecret({ JWT_SECRET: secret }), secret);

});


test('production administrator bootstrap preserves business data and refuses to replace an administrator', async () => {
  process.env.ADMIN_EMAIL = 'first-admin@example.test';
  process.env.ADMIN_PASSWORD = randomBytes(24).toString('hex');
  const { bootstrapAdmin } = loadTypeScript('src/scripts/bootstrap-admin.ts', { '../db': { prisma } });
  const initialBills = await prisma.bill.count();
  await bootstrapAdmin();
  const first = await prisma.user.findUnique({ where: { username: process.env.ADMIN_EMAIL } });
  assert.equal(first.role, 'GLOBAL_ADMIN');
  assert.equal(await prisma.bill.count(), initialBills);
  await assert.rejects(bootstrapAdmin(), /already exists/);
  assert.equal((await prisma.user.findUnique({ where: { id: first.id } })).passwordHash, first.passwordHash);
  delete process.env.ADMIN_PASSWORD;
});

test('production preparation creates private secrets once and rejects malformed domains', () => {
  const root = path.join(temp, 'setup');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const script = path.join(root, 'scripts/prepare-production.cjs');
  fs.copyFileSync(path.resolve(__dirname, '../../scripts/prepare-production.cjs'), script);
  execFileSync(process.execPath, [script, 'dive.example.test', 'admin@example.test']);
  const first = fs.readFileSync(path.join(root, 'secrets/jwt_secret'), 'utf8');
  assert.equal(first.length, 96);
  const authenticatorKey = fs.readFileSync(path.join(root, 'secrets/authenticator_key'), 'utf8');
  assert.match(authenticatorKey, /^[a-f0-9]{64}$/);
  const databasePassword = fs.readFileSync(path.join(root, 'secrets/database_password'), 'utf8');
  const postgresAdminPassword = fs.readFileSync(path.join(root, 'secrets/postgres_admin_password'), 'utf8');
  const databaseUrl = fs.readFileSync(path.join(root, 'secrets/database_url'), 'utf8');
  assert.match(databasePassword, /^[a-f0-9]{64}$/);
  assert.match(postgresAdminPassword, /^[a-f0-9]{64}$/);
  assert.notEqual(databasePassword, postgresAdminPassword);
  const connection = new URL(databaseUrl);
  assert.equal(connection.protocol, 'postgresql:');
  assert.equal(connection.hostname, 'db');
  assert.equal(connection.username, 'dive_center');
  assert.equal(connection.password, databasePassword);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/admin_password'), 'utf8').length, 48);
  assert.equal(fs.statSync(path.join(root, 'secrets')).mode & 0o777, 0o700);
  execFileSync(process.execPath, [script, 'dive.example.test', 'admin@example.test']);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/jwt_secret'), 'utf8'), first);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/authenticator_key'), 'utf8'), authenticatorKey);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/database_url'), 'utf8'), databaseUrl);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/database_password'), 'utf8'), databasePassword);
  assert.throws(() => execFileSync(process.execPath, [script, 'https://bad/path', 'admin@example.test'], { stdio: 'pipe' }));
});
