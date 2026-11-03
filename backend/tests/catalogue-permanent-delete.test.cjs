const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('permanentdelete');
const { prisma } = database;
const actor = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const authStub = { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in.' }) };
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', { '../db': { prisma }, '../middleware/auth': authStub });
const remove = (itemIds, extra = {}, user = actor, router = itemsRouter) => request(router, 'POST', '/bulk-permanent-delete', { user, body: { propertyId: 'a', itemIds, confirmation: 'DELETE PERMANENTLY', ...extra } });
test.before(async () => {
  await prisma.user.create({ data: { id: actor.id, username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
  for (const id of ['a', 'b']) {
    await prisma.property.create({ data: { id, name: id, code: id } });
    await prisma.category.create({ data: { id, propertyId: id, name: 'Dives' } });
  }
  await prisma.item.createMany({ data: ['first', 'second', 'active', 'billed', 'packaged', 'foreign', 'rollback'].map(id => ({
    id, propertyId: id === 'foreign' ? 'b' : 'a', categoryId: id === 'foreign' ? 'b' : 'a', code: id, name: id, price: 100, isActive: id === 'active',
  })) });
  await prisma.bill.create({ data: { id: 'bill', propertyId: 'a', checkNumber: 1, businessDate: '2026-11-01', guestName: 'Guest', roomNumber: '0012', createdById: actor.id, netAmount: 100,
    items: { create: { itemId: 'billed', itemName: 'Historical dive', categoryName: 'Dives', quantity: 1, unitPrice: 100, lineTotal: 100, totalPersonalCommission: 5 } } } });
  await prisma.divePackage.create({ data: { id: 'package', propertyId: 'a', code: 'PKG', name: 'Package', price: 200, isActive: false, items: { create: { itemId: 'packaged', quantity: 2 } } } });
});
test.after(() => database.dispose());

test('requires authentication, manager permissions, property access and explicit confirmation', async () => {
  assert.equal((await remove(['first'], {}, null)).status, 401);
  assert.equal((await remove(['first'], {}, { ...actor, role: 'CENTRE_STAFF' })).status, 403);
  assert.equal((await remove(['first'], {}, { ...actor, assignedPropertyIds: ['b'] })).status, 403);
  for (const extra of [{ confirmation: undefined }, { confirmation: 'DELETE' }, { confirmation: true }, { itemIds: [] }, { itemIds: ['first', 'first'] }, { itemIds: Array.from({ length: 201 }, (_, i) => String(i)) }]) assert.equal((await remove(['first'], extra)).status, 400);
  assert.equal(await prisma.item.count(), 7);
});

test('rejects active, foreign, missing, billed and packaged selections without partial deletion', async () => {
  const bill = await prisma.bill.findUnique({ where: { id: 'bill' }, include: { items: true } });
  const pkg = await prisma.divePackage.findUnique({ where: { id: 'package' }, include: { items: true } });
  for (const id of ['active', 'foreign', 'missing', 'billed', 'packaged']) assert.equal((await remove(['first', id])).status, 409, id);
  assert.equal(await prisma.item.count(), 7);
  assert.deepEqual(await prisma.bill.findUnique({ where: { id: 'bill' }, include: { items: true } }), bill);
  assert.deepEqual(await prisma.divePackage.findUnique({ where: { id: 'package' }, include: { items: true } }), pkg);
});

test('an audit failure rolls back permanent deletion', async () => {
  const broken = { $transaction: (operation, options) => prisma.$transaction(tx => operation(new Proxy(tx, { get(target, name) {
    if (name === 'auditLog') return { create: async () => { throw new Error('Audit unavailable'); } };
    const value = Reflect.get(target, name);
    return typeof value === 'function' ? value.bind(target) : value;
  } })), options) };
  const { itemsRouter: failingRouter } = loadTypeScript('src/routes/items.routes.ts', { '../db': { prisma: broken }, '../middleware/auth': authStub });
  assert.equal((await remove(['rollback'], {}, actor, failingRouter)).status, 500);
  assert.ok(await prisma.item.findUnique({ where: { id: 'rollback' } }));
});

test('permanently deletes an unused archived batch and keeps audit records and categories', async () => {
  const result = await remove(['first', 'second']);
  assert.equal(result.status, 200);
  assert.equal(result.body.deletedCount, 2);
  assert.equal(await prisma.item.count({ where: { id: { in: ['first', 'second'] } } }), 0);
  assert.equal(await prisma.category.count(), 2);
  const logs = await prisma.auditLog.findMany({ where: { action: 'ITEM_PERMANENT_DELETE' } });
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map(log => JSON.parse(log.details).code).sort(), ['first', 'second']);
  assert.equal((await remove(['first'])).status, 409);
  const reused = await request(itemsRouter, 'POST', '/', { user: actor, body: { propertyId: 'a', categoryId: 'a', name: 'Replacement activity', price: 50, code: 'first' } });
  assert.equal(reused.status, 201);
  assert.equal(reused.body.item.code, 'first');
});

test('a removed property stays read-only even for global administrators', async () => {
  await prisma.property.update({ where: { id: 'a' }, data: { deletedAt: new Date(), isActive: false } });
  assert.equal((await remove(['rollback'], {}, { ...actor, role: 'GLOBAL_ADMIN' })).status, 400);
  assert.ok(await prisma.item.findUnique({ where: { id: 'rollback' } }));
});
