const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('activities');
const prisma = database.prisma;
process.env.JWT_SECRET = randomBytes(48).toString('hex');
delete process.env.JWT_SECRET_FILE;
const stubs = { '../db': { prisma } };
const auth = loadTypeScript('src/middleware/auth.ts', stubs);
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const tokens = {};
const call = (method, url, body = {}, role = 'manager', query = {}, router = itemsRouter) => request(router, method, url, { user: null, body, query, headers: tokens[role] ? { authorization: `Bearer ${tokens[role]}`, 'x-property-id': 'a' } : {} });
const catalogue = (propertyId = 'a', role = 'manager', includeInactive) => call('GET', '/', {}, role, { propertyId, ...(includeInactive === undefined ? {} : { includeInactive }) });
const activity = (propertyId = 'a') => ({ propertyId, categoryId: `cat-${propertyId}`, code: 'PROMO', name: 'Sunset dive promotion', price: 39.5, poolType: 'DIVE_POOL', poolContribution: 5, personalRoles: 'seller,guide', personalRatesJson: '{"seller":2,"guide":3}' });

test.beforeEach(async () => {
  await prisma.auditLog.deleteMany(); await prisma.billItem.deleteMany(); await prisma.bill.deleteMany();
  await prisma.item.deleteMany(); await prisma.category.deleteMany(); await prisma.userProperty.deleteMany();
  await prisma.property.deleteMany(); await prisma.user.deleteMany();
  await prisma.property.createMany({ data: ['a', 'b', 'removed'].map(id => ({ id, name: `Centre ${id}`, code: id.toUpperCase(), ...(id === 'removed' ? { deletedAt: new Date(), isActive: false } : {}) })) });
  for (const [id, role, properties] of [['admin', 'GLOBAL_ADMIN', []], ['manager', 'PROPERTY_MANAGER', ['a']], ['multi', 'PROPERTY_MANAGER', ['a', 'b']], ['staff', 'CENTRE_STAFF', ['a']]]) {
    const user = await prisma.user.create({ data: { id, username: id, name: id, role, passwordHash: 'fixture-hash', authenticator: { create: { enrolledAt: new Date(), secretCiphertext: 'fixture' } }, assignedProperties: { create: properties.map(propertyId => ({ propertyId })) } } });
    tokens[id] = auth.signToken(user);
  }
  for (const id of ['a', 'b', 'removed']) {
    await prisma.category.create({ data: { id: `cat-${id}`, propertyId: id, name: 'Dives' } });
    await prisma.item.create({ data: { id: `item-${id}`, propertyId: id, categoryId: `cat-${id}`, code: 'DIVE', name: `Dive ${id}`, price: id === 'a' ? 85 : 120, poolType: 'DIVE_POOL', poolContribution: 5 } });
  }
});
test.after(() => database.dispose());

test('a manager can create, read, update, delete and restore their property activities with audit entries', async () => {
  const created = await call('POST', '/', activity());
  assert.equal(created.status, 201);
  const id = created.body.item.id;
  assert.ok((await catalogue()).body.items.some(item => item.id === id));
  const edited = await call('PUT', `/${id}`, { name: 'Weekend offer', price: 29, code: created.body.item.code });
  assert.equal(edited.status, 200); assert.equal(edited.body.item.price, 29);
  assert.equal(edited.body.item.poolType, 'DIVE_POOL'); assert.equal(edited.body.item.poolContribution, 5);
  assert.equal((await call('DELETE', `/${id}`)).status, 200);
  assert.equal((await prisma.item.findUnique({ where: { id } })).isActive, false);
  assert.equal((await catalogue()).body.items.some(item => item.id === id), false);
  assert.equal((await catalogue('a', 'manager', 'true')).body.items.find(item => item.id === id).isActive, false);
  assert.equal((await call('PUT', `/${id}`, { isActive: true })).status, 200);
  assert.equal((await catalogue()).body.items.some(item => item.id === id), true);
  const events = await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(events.map(event => event.action), ['ITEM_CREATE', 'ITEM_UPDATE', 'ITEM_DELETE', 'ITEM_RESTORE']);
  assert.ok(events.every(event => event.propertyId === 'a' && event.userId === 'manager'));
});

test('property boundaries cannot be bypassed through activity IDs, foreign categories, headers or body property IDs', async () => {
  const before = await prisma.item.findUnique({ where: { id: 'item-b' } });
  assert.equal((await catalogue('b')).status, 403);
  assert.equal((await catalogue('b', 'manager', 'true')).status, 403);
  assert.equal((await call('POST', '/', activity('b'))).status, 403);
  assert.equal((await call('PUT', '/item-b', { price: 1 })).status, 403);
  assert.equal((await call('DELETE', '/item-b')).status, 403);
  assert.equal((await call('PUT', '/item-b', { isActive: true })).status, 403);
  assert.equal((await call('PUT', '/item-a', { propertyId: 'b', price: 1 })).status, 400);
  assert.equal((await call('PUT', '/item-a', { categoryId: 'cat-b' })).status, 400);
  assert.equal((await call('POST', '/', { ...activity(), categoryId: 'cat-b' })).status, 400);
  assert.deepEqual(await prisma.item.findUnique({ where: { id: 'item-b' } }), before);
  assert.equal(await prisma.auditLog.count(), 0);
});

test('staff may read active own-property activities but cannot manage them; authentication is required', async () => {
  assert.equal((await catalogue('a', 'staff')).status, 200);
  assert.equal((await catalogue('a', 'staff', 'true')).status, 403);
  for (const role of ['staff', 'none']) {
    const status = role === 'staff' ? 403 : 401;
    for (const [method, url, body] of [['POST', '/', activity()], ['PUT', '/item-a', { price: 1 }], ['DELETE', '/item-a', {}], ['PUT', '/item-a', { isActive: true }]]) assert.equal((await call(method, url, body, role)).status, status);
  }
  assert.equal((await catalogue('a', 'none')).status, 401);
  assert.equal(await prisma.auditLog.count(), 0);
});

test('the same activity code has independent prices and promotions in each property', async () => {
  assert.equal((await call('POST', '/', activity())).status, 201);
  const b = await call('POST', '/', { ...activity('b'), price: 65 }, 'multi');
  assert.equal(b.status, 201);
  assert.equal((await call('PUT', '/item-a', { price: 70 })).status, 200);
  assert.equal((await prisma.item.findUnique({ where: { id: 'item-b' } })).price, 120);
  assert.equal((await prisma.item.findUnique({ where: { id: b.body.item.id } })).price, 65);
  assert.equal((await catalogue('b', 'multi')).body.items.every(item => item.propertyId === 'b'), true);
});

test('global administrators retain activity management across properties', async () => {
  const created = await call('POST', '/', activity('b'), 'admin');
  assert.equal(created.status, 201);
  assert.equal((await catalogue('b', 'admin', 'true')).status, 200);
  assert.equal((await call('PUT', `/${created.body.item.id}`, { price: 55 }, 'admin')).status, 200);
  assert.equal((await call('DELETE', `/${created.body.item.id}`, {}, 'admin')).status, 200);
  assert.equal((await call('PUT', `/${created.body.item.id}`, { isActive: true }, 'admin')).status, 200);
});

test('invalid prices, rates, flags and duplicate codes cannot corrupt the catalogue; free promotional activities are supported', async () => {
  const before = await prisma.item.findUnique({ where: { id: 'item-a' } });
  for (const patch of [{ price: -1 }, { price: '12' }, { price: null }, { price: Infinity }, { name: ' ' }, { code: '' }, { poolType: 'OTHER' }, { poolContribution: -1 }, { personalRoles: 'hacker' }, { personalRatesJson: 'broken' }, { personalRatesJson: 'null' }, { personalRatesJson: '[]' }, { personalRatesJson: '{"seller":-1}' }, { personalRatesJson: '{"seller":"5"}' }, { isActive: 'false' }, { isActive: null }, { unknown: 'field' }, {}]) assert.equal((await call('PUT', '/item-a', patch)).status, 400, JSON.stringify(patch));
  assert.deepEqual(await prisma.item.findUnique({ where: { id: 'item-a' } }), before);
  assert.equal((await catalogue('a', 'manager', 'invalid')).status, 400);
  assert.equal((await call('POST', '/', { ...activity(), price: -1 })).status, 400);
  const free = await call('POST', '/', { ...activity(), price: 0 });
  assert.equal(free.status, 201); assert.equal(free.body.item.price, 0);
  const second = await call('POST', '/', activity());
  assert.equal(second.status, 201);
  assert.notEqual(second.body.item.code, free.body.item.code);
  await call('DELETE', `/${free.body.item.id}`);
  assert.equal((await call('PUT', '/item-a', { code: 'PROMO' })).status, 400);
  const third = await call('POST', '/', activity());
  assert.equal(third.status, 201);
  assert.notEqual(third.body.item.code, free.body.item.code);
});

test('price edits and deletion retain saved bill snapshots; deleted activities cannot be billed until restored', async () => {
  await prisma.bill.create({ data: { id: 'saved', propertyId: 'a', checkNumber: 1001, businessDate: '2026-10-20', guestName: 'Guest', roomNumber: '104', createdById: 'manager', netAmount: 85, items: { create: { itemId: 'item-a', itemName: 'Dive a', categoryName: 'Dives', quantity: 1, unitPrice: 85, lineTotal: 85 } } } });
  const before = await prisma.bill.findUnique({ where: { id: 'saved' }, include: { items: true } });
  assert.equal((await catalogue('a', 'manager', 'true')).body.items.find(item => item.id === 'item-a').hasBillHistory, true);
  assert.equal((await call('PUT', '/item-a', { poolContribution: 20 })).status, 409);
  assert.equal((await call('PUT', '/item-a', { poolType: 'COURSE_POOL' })).status, 409);
  assert.equal((await call('PUT', '/item-a', { price: 50, name: 'Promotional dive' })).status, 200);
  assert.equal((await call('DELETE', '/item-a')).status, 200);
  assert.deepEqual(await prisma.bill.findUnique({ where: { id: 'saved' }, include: { items: true } }), before);
  const body = { propertyId: 'a', checkNumber: 1002, businessDate: '2026-10-20', guestName: 'New guest', roomNumber: '105', items: [{ itemId: 'item-a', itemName: 'Promotional dive', categoryName: 'Dives', quantity: 1, unitPrice: 50 }] };
  assert.equal((await call('POST', '/', body, 'staff', {}, billsRouter)).status, 400);
  assert.equal((await call('PUT', '/item-a', { isActive: true })).status, 200);
  assert.equal((await call('POST', '/', body, 'staff', {}, billsRouter)).status, 201);
  assert.equal((await prisma.bill.findFirst({ where: { checkNumber: 1002 }, include: { items: true } })).items[0].unitPrice, 50);
});

test('removed properties remain read-only and unknown activity IDs are handled', async () => {
  assert.equal((await call('DELETE', '/item-removed', {}, 'admin')).status, 410);
  assert.equal((await call('PUT', '/item-removed', { isActive: true }, 'admin')).status, 410);
  assert.equal((await call('POST', '/', activity('removed'), 'admin')).status, 410);
  assert.equal((await call('DELETE', '/missing')).status, 404);
  assert.equal((await call('PUT', '/missing', { price: 12 })).status, 404);
});
