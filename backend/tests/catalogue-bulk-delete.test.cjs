const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('bulkdelete');
const { prisma } = database;
const actor = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', {
  '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => next() },
});
const remove = (itemIds, user = actor, propertyId = 'a') => request(itemsRouter, 'POST', '/bulk-delete', { user, body: { propertyId, itemIds } });
test.before(async () => {
  await prisma.user.create({ data: { id: 'manager', username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
  for (const id of ['a', 'b']) {
    await prisma.property.create({ data: { id, name: id, code: id } });
    await prisma.category.create({ data: { id, propertyId: id, name: 'Services' } });
  }
  await prisma.item.createMany({ data: ['first', 'second', 'foreign'].map(id => ({
    id, propertyId: id === 'foreign' ? 'b' : 'a', categoryId: id === 'foreign' ? 'b' : 'a', code: id, name: id, price: 100,
  })) });
});
test.after(() => database.dispose());
test('rejects invalid selections and unauthorized users without changing items', async () => {
  for (const ids of [[], ['first', 'first'], Array.from({ length: 201 }, (_, i) => String(i))]) assert.equal((await remove(ids)).status, 400);
  assert.equal((await remove(['first'], { ...actor, role: 'CENTRE_STAFF' })).status, 403);
  assert.equal((await remove(['foreign'], actor, 'b')).status, 403);
  assert.equal((await remove(['first', 'foreign'])).status, 400);
  assert.equal((await remove(['first', 'missing'])).status, 400);
  assert.equal(await prisma.item.count({ where: { isActive: true } }), 3);
});
test('deletes the whole selection, retains catalogue records and audits each item', async () => {
  const result = await remove(['first', 'second']);
  assert.equal(result.status, 200);
  assert.equal(result.body.deletedCount, 2);
  assert.equal(await prisma.item.count({ where: { propertyId: 'a', isActive: false } }), 2);
  assert.equal((await prisma.item.findUnique({ where: { id: 'foreign' } })).isActive, true);
  assert.equal(await prisma.auditLog.count({ where: { action: 'ITEM_DELETE', propertyId: 'a' } }), 2);
  assert.equal((await remove(['first'])).status, 400);
});
