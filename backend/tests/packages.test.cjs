const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('packages');
const { prisma } = database;
const manager = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['prop-a'] };
const staff = { id: 'staff', role: 'CENTRE_STAFF', assignedPropertyIds: ['prop-a'] };
const { packagesRouter } = loadTypeScript('src/routes/packages.routes.ts', {
  '../db': { prisma },
  '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) },
});

test.before(async () => {
  await prisma.property.createMany({
    data: [
      { id: 'prop-a', code: 'PROPA', name: 'Centre A', autoPhotoPrice: 41.975, autoPhotoCommission: 4.5 },
      { id: 'prop-b', code: 'PROPB', name: 'Centre B' },
    ],
  });
  await prisma.category.create({ data: { id: 'cat-dives', propertyId: 'prop-a', name: 'Dives' } });
  await prisma.item.createMany({
    data: [
      { id: 'item-1', propertyId: 'prop-a', categoryId: 'cat-dives', code: 'DIVE-1', name: 'Single Boat Dive', price: 90 },
      { id: 'item-2', propertyId: 'prop-a', categoryId: 'cat-dives', code: 'DIVE-2', name: 'Night Dive', price: 120 },
    ],
  });
});

test.after(() => database.dispose());

test('staff can list packages but cannot create or modify them', async () => {
  const getRes = await request(packagesRouter, 'GET', '/', { query: { propertyId: 'prop-a' }, user: staff });
  assert.equal(getRes.status, 200);

  const postRes = await request(packagesRouter, 'POST', '/', {
    body: { propertyId: 'prop-a', name: '5 Dives', code: 'PKG-5', price: 400, items: [{ itemId: 'item-1', quantity: 5 }] },
    user: staff,
  });
  assert.equal(postRes.status, 403);
});

test('manager can create, list, update, and delete dive packages', async () => {
  // 1. Create
  const createRes = await request(packagesRouter, 'POST', '/', {
    body: {
      propertyId: 'prop-a',
      name: '5 Dives Package',
      code: 'pkg-5dive',
      description: 'Includes 5 boat dives',
      price: 400,
      items: [{ itemId: 'item-1', quantity: 5 }],
    },
    user: manager,
  });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.package.code, 'PKG-5DIVE');
  assert.equal(createRes.body.package.price, 450);
  assert.equal(createRes.body.package.items.length, 1);
  assert.equal(createRes.body.package.items[0].quantity, 5);

  const pkgId = createRes.body.package.id;

  // 2. List
  const listRes = await request(packagesRouter, 'GET', '/', { query: { propertyId: 'prop-a' }, user: manager });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.packages.length, 1);
  assert.equal(listRes.body.packages[0].name, '5 Dives Package');

  // 3. Update
  const updateRes = await request(packagesRouter, 'PUT', `/${pkgId}`, {
    body: {
      name: '5 Dives + 1 Night Dive',
      price: 480,
      items: [
        { itemId: 'item-1', quantity: 5 },
        { itemId: 'item-2', quantity: 1 },
      ],
    },
    user: manager,
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.package.name, '5 Dives + 1 Night Dive');
  assert.equal(updateRes.body.package.price, 570);
  assert.equal(updateRes.body.package.items.length, 2);

  // 4. Delete
  const delRes = await request(packagesRouter, 'DELETE', `/${pkgId}`, { user: manager });
  assert.equal(delRes.status, 200);

  const afterDel = await request(packagesRouter, 'GET', '/', { query: { propertyId: 'prop-a' }, user: manager });
  assert.equal(afterDel.body.packages.length, 0);
});


test('package totals use current catalogue prices and quantities, ignoring client-supplied prices', async () => {
  const created = await request(packagesRouter, 'POST', '/', {
    user: manager,
    body: { propertyId: 'prop-a', name: 'Calculated bundle', code: 'CALCULATED',
      items: [{ itemId: 'item-1', quantity: 2 }, { itemId: 'item-1', quantity: 1 }, { itemId: 'item-2', quantity: 2 }] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.package.price, 510);
  assert.equal(created.body.package.items.find(row => row.itemId === 'item-1').quantity, 3);
  const id = created.body.package.id;
  const overridden = await request(packagesRouter, 'PUT', `/${id}`, { user: manager, body: { price: 1 } });
  assert.equal(overridden.status, 200);
  assert.equal(overridden.body.package.price, 510);
  await prisma.item.update({ where: { id: 'item-1' }, data: { price: 95 } });
  const listed = await request(packagesRouter, 'GET', '/', { query: { propertyId: 'prop-a' }, user: staff });
  assert.equal(listed.body.packages.find(pkg => pkg.id === id).price, 525);
  const metadataUpdate = await request(packagesRouter, 'PUT', `/${id}`, { user: manager, body: { name: 'Updated bundle' } });
  assert.equal(metadataUpdate.body.package.price, 525);
  const replaced = await request(packagesRouter, 'PUT', `/${id}`, { user: manager, body: { items: [{ itemId: 'item-2', quantity: 1 }] } });
  assert.equal(replaced.body.package.price, 120);
  await prisma.item.update({ where: { id: 'item-1' }, data: { price: 90 } });
});

test('calculated packages reject unavailable and other-property items', async () => {
  for (const itemId of ['missing', 'item-1']) {
    const response = await request(packagesRouter, 'POST', '/', { user: { ...manager, assignedPropertyIds: ['prop-b'] }, body: {
      propertyId: 'prop-b', name: 'Invalid bundle', code: 'INVALID-' + itemId, items: [{ itemId, quantity: 1 }],
    } });
    assert.equal(response.status,400);
  }
});
