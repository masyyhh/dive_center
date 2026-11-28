const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const database = createTestDatabase('separatelines');
const { prisma } = database;
const stubs = { '../db': { prisma }, '../middleware/auth': { requireAuth: (_req, _res, next) => next() } };
const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', stubs);
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', stubs);
const user = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['own'] };
let check = 9000;
const line = (extra = {}) => ({ clientLineId: 'unit', itemId: 'custom', itemName: 'Custom excursion', categoryName: 'Services', quantity: 1, unitPrice: 85, ...extra });
const save = (items, extra = {}) => request(billsRouter, 'POST', '/', { user, body: { propertyId: 'own', checkNumber: check++, businessDate: '2026-11-28', guestName: 'Guest', roomNumber: '0012', items, ...extra } });
const update = (bill, items) => request(billsRouter, 'PUT', `/${bill.id}`, { user, body: { propertyId: 'own', checkNumber: bill.checkNumber, businessDate: bill.businessDate, guestName: bill.guestName, roomNumber: bill.roomNumber, expectedUpdatedAt: bill.updatedAt.toISOString(), editReason: 'Update individual unit', items } });
test.before(async () => {
 await prisma.property.create({ data: { id: 'own', name: 'Own', code: 'OWN' } });
 await prisma.user.create({ data: { id: 'manager', username: 'separate-manager', name: 'Manager', passwordHash: 'unused' } });
 await prisma.category.create({ data: { id: 'services', propertyId: 'own', name: 'Services' } });
 await prisma.item.createMany({ data: [
  { id: 'custom', propertyId: 'own', categoryId: 'services', code: 'CUSTOM', name: 'Excursion', price: 100, separateLinePerUnit: true },
  { id: 'ordinary', propertyId: 'own', categoryId: 'services', code: 'NORMAL', name: 'Ordinary activity', price: 50 },
  { id: 'media', propertyId: 'own', categoryId: 'services', code: 'MEDIA', name: 'Media excursion', price: 100, separateLinePerUnit: true, includesComplimentaryMedia: true },
 ] });
});
test.after(() => database.dispose());
test('property managers can configure the rule only for their property', async () => {
 const body = { separateLinePerUnit: true };
 for (const actor of [{ ...user, role: 'STAFF' }, { ...user, assignedPropertyIds: ['other'] }]) {
  assert.equal((await request(itemsRouter, 'PUT', '/ordinary', { user: actor, body })).status, 403);
 }
 const result = await request(itemsRouter, 'PUT', '/ordinary', { user, body });
 assert.equal(result.status, 200); assert.equal(result.body.item.separateLinePerUnit, true);
 await prisma.item.update({ where: { id: 'ordinary' }, data: { separateLinePerUnit: false } });
 const created = await request(itemsRouter, 'POST', '/', { user, body: { propertyId: 'own', categoryId: 'services', name: 'New custom item', price: 30, separateLinePerUnit: true } });
 assert.equal(created.status, 201); assert.equal(created.body.item.separateLinePerUnit, true);
});
test('each unit retains its own name and price through save and edit', async () => {
 const result = await save([line({ itemName: 'Sunset excursion', unitPrice: 85 }), line({ clientLineId: 'unit2', itemName: 'Private excursion', unitPrice: 125 })]);
 assert.equal(result.status, 201, JSON.stringify(result.body));
 const bill = result.body.bill;
 assert.equal(bill.grossAmount, 210);
 assert.deepEqual(bill.items.map(row => [row.itemName, row.unitPrice, row.quantity, row.separateLinePerUnit]), [['Sunset excursion', 85, 1, true], ['Private excursion', 125, 1, true]]);
 await prisma.item.update({ where: { id: 'custom' }, data: { separateLinePerUnit: false, name: 'Catalogue renamed', price: 200 } });
 try {
  const edited = await update(bill, bill.items.map((row, index) => ({ ...row, sourceLineId: row.id, clientLineId: row.id, itemName: index ? row.itemName : 'Morning excursion', unitPrice: index ? row.unitPrice : 90 })));
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.bill.items[0].itemName, 'Morning excursion');
  assert.equal(edited.body.bill.items[0].unitPrice, 90);
  assert.equal(edited.body.bill.items[0].separateLinePerUnit, true);
 } finally { await prisma.item.update({ where: { id: 'custom' }, data: { separateLinePerUnit: true } }); }
});
test('the server enforces one unit, names and property rules independently of client flags', async () => {
 assert.equal((await save([line({ quantity: 3, separateLinePerUnit: false })])).status, 400);
 for (const itemName of ['', '   ', 'x'.repeat(201)]) assert.equal((await save([line({ itemName })])).status, 400);
 const ordinary = await save([line({ itemId: 'ordinary', itemName: 'Forged custom name', quantity: 3, unitPrice: 50, separateLinePerUnit: true })]);
 assert.equal(ordinary.status, 201);
 assert.equal(ordinary.body.bill.items[0].itemName, 'Ordinary activity');
 assert.equal(ordinary.body.bill.items[0].quantity, 3);
 assert.equal(ordinary.body.bill.items[0].separateLinePerUnit, false);
});
test('each separate unit keeps its own linked Photo line', async () => {
 const result = await save([line({ itemId: 'media', clientLineId: 'm1', itemName: 'Morning dive' }), line({ itemId: 'media', clientLineId: 'm2', itemName: 'Evening dive', unitPrice: 120 }), ...['m1','m2'].map(key => line({ itemId: null, clientLineId: `${key}-photo`, autoPhotoFor: key, itemName: 'Photo', unitPrice: 41.975 }))]);
 assert.equal(result.status, 201, JSON.stringify(result.body));
 assert.equal(result.body.bill.items.length, 4);
 for (const row of result.body.bill.items.filter(row => !row.autoPhotoForLineId)) assert.equal(result.body.bill.items.filter(photo => photo.autoPhotoForLineId === row.id).length, 1);
});

test('three lines for the same item retain three different names and prices after saving and reopening', async () => {
 const expected=[['Morning trip',85],['Private sunset trip',145],['Night trip',120]];
 const result=await save(expected.map(([itemName,unitPrice],index)=>line({clientLineId:`triple-${index}`,itemName,unitPrice})));
 assert.equal(result.status,201,JSON.stringify(result.body));
 const bill=result.body.bill;
 assert.equal(bill.items.length,3);
 assert.equal(bill.grossAmount,350);
 const reopened=await request(billsRouter,'GET',`/${bill.id}`,{user});
 assert.equal(reopened.status,200,JSON.stringify(reopened.body));
 assert.deepEqual(reopened.body.bill.items.map(row=>[row.itemId,row.quantity,row.itemName,row.unitPrice]),expected.map(([name,price])=>['custom',1,name,price]));
 const edits=expected.map(([name,price])=>[`${name} revised`,price+5]);
 const edited=await update(bill,bill.items.map((row,index)=>({...row,sourceLineId:row.id,clientLineId:row.id,itemName:edits[index][0],unitPrice:edits[index][1]})));
 assert.equal(edited.status,200,JSON.stringify(edited.body));
 const saved=await prisma.billItem.findMany({where:{billId:bill.id},orderBy:{linePosition:'asc'}});
 assert.deepEqual(saved.map(row=>[row.itemId,row.quantity,row.itemName,row.unitPrice]),edits.map(([name,price])=>['custom',1,name,price]));
});
