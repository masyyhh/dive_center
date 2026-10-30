const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('bulkmedia');
const { prisma } = database;
const manager = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] };
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', { '../db': { prisma }, '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) } });
const call = (body, user = manager) => request(itemsRouter, 'POST', '/bulk-complimentary-media', { body, user });
const preview = (itemIds = ['a1', 'a2']) => call({ propertyId: 'a', itemIds, includesComplimentaryMedia: true, preview: true });
const commit = review => call({ propertyId: 'a', itemIds: review.items.map(item => item.id), includesComplimentaryMedia: true, preview: false, expectedItems: review.items.map(({ id, updatedAt }) => ({ id, updatedAt: new Date(updatedAt).toISOString() })) });
test.before(async () => {
  await prisma.user.create({ data: { id: 'manager', username: 'manager', name: 'Manager', passwordHash: 'fixture' } });
  await prisma.property.createMany({ data: ['a', 'b'].map(id => ({ id, code: id, name: id })) });
  for (const propertyId of ['a', 'b']) await prisma.category.create({ data: { id: propertyId, name: 'Dives', propertyId } });
  await prisma.item.createMany({ data: ['a1', 'a2', 'b1', 'archived'].map(id => ({ id, propertyId: id === 'b1' ? 'b' : 'a', categoryId: id === 'b1' ? 'b' : 'a', code: id, name: id, price: 100, isActive: id !== 'archived' })) });
});
test.beforeEach(async () => { await prisma.item.updateMany({ data: { includesComplimentaryMedia: false } }); await prisma.auditLog.deleteMany(); });
test.after(() => database.dispose());
test('bulk preview is read-only and changes require manager permissions in the selected property', async () => {
  const body = { propertyId: 'a', itemIds: ['a1'], includesComplimentaryMedia: true };
  assert.equal((await call(body, null)).status, 401);
  assert.equal((await call(body, { ...manager, role: 'CENTRE_STAFF' })).status, 403);
  assert.equal((await call({ ...body, propertyId: 'b' })).status, 403);
  const result = await preview();
  assert.equal(result.status, 200); assert.equal(result.body.changedCount, 2);
  assert.equal(await prisma.item.count({ where: { includesComplimentaryMedia: true } }), 0);
  assert.equal(await prisma.auditLog.count(), 0);
});
test('a reviewed batch saves all services together and records one scoped audit event', async () => {
  const review = (await preview()).body;
  const result = await commit(review);
  assert.equal(result.status, 200); assert.equal(result.body.changedCount, 2);
  assert.equal(await prisma.item.count({ where: { propertyId: 'a', includesComplimentaryMedia: true } }), 2);
  assert.equal((await prisma.item.findUnique({ where: { id: 'b1' } })).includesComplimentaryMedia, false);
  const events = await prisma.auditLog.findMany();
  assert.equal(events.length, 1); assert.equal(events[0].action, 'ITEM_BULK_MEDIA_UPDATE'); assert.equal(events[0].propertyId, 'a');
});
test('stale reviews roll back every row, including earlier writes in the batch', async () => {
  const review = (await preview()).body;
  await prisma.item.update({ where: { id: 'a2' }, data: { price: 101, updatedAt: new Date(Date.now() + 1000) } });
  assert.equal((await commit(review)).status, 409);
  assert.equal(await prisma.item.count({ where: { includesComplimentaryMedia: true } }), 0);
  assert.equal(await prisma.auditLog.count(), 0);
});
test('foreign, archived, duplicate, oversized and unreviewed selections do not change any service', async () => {
  for (const ids of [['a1', 'b1'], ['a1', 'archived']]) assert.equal((await preview(ids)).status, 409);
  assert.equal((await preview(['a1', 'a1'])).status, 400);
  assert.equal((await preview(Array.from({ length: 201 }, (_, index) => `item-${index}`))).status, 400);
  assert.equal((await call({ propertyId: 'a', itemIds: ['a1'], includesComplimentaryMedia: true, preview: false })).status, 400);
  assert.equal(await prisma.item.count({ where: { includesComplimentaryMedia: true } }), 0);
});
