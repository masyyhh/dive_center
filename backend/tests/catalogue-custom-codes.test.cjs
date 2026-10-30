const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');

test('import preview and commit preserve custom codes alongside generated and existing codes', async () => {
  const existing = { id: 'old', code: '13152', propertyId: 'a', poolType: 'DIVE_POOL', poolContribution: 10 };
  const writes = [];
  const audits = [];
  const tx = {
    property: { findUnique: async () => ({ isActive: true }) },
    item: {
      findMany: async ({ where }) => { assert.equal(where.propertyId, 'a'); return [existing]; },
      create: async ({ data }) => { writes.push(data); return { id: data.code, ...data }; },
      update: async ({ where, data }) => { assert.equal(where.id, 'old'); writes.push(data); return { ...existing, ...data }; },
    },
    category: { findMany: async () => [{ id: 'diving', name: 'Diving' }] },
  };
  const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', {
    '../db': { prisma: {} },
    '../middleware/auth': { requireAuth: (req, res, next) => next() },
    '../utils/payrollTransaction': { withPropertyPayrollTransaction: async (client, propertyId, operation) => operation(tx) },
    '../services/auditService': { logAuditEvent: async event => audits.push(event) },
  });
  const content = Buffer.from([
    'Item Code,Items,Category,Price,Commission,Status',
    ',Generated item,Diving,50,0,Active',
    'DIV-001,Supplied sequence,Diving,60,0,Active',
    '00123,Leading zeros,Diving,70,0,Active',
    '13152,Updated existing,Diving,80,10,Active',
  ].join('\n')).toString('base64');
  const call = preview => request(itemsRouter, 'POST', '/import', {
    body: { propertyId: 'a', format: 'csv', content, preview },
    user: { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] },
  });
  const preview = await call(true);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.created, 3); assert.equal(preview.body.updated, 1);
  assert.equal(preview.body.previewRows[2].code, '00123');
  assert.equal(writes.length, 0); assert.equal(audits.length, 0);
  const committed = await call(false);
  assert.equal(committed.status, 200);
  assert.equal(committed.body.created, 3); assert.equal(committed.body.updated, 1);
  assert.deepEqual(writes.slice(0, 3).map(item => item.code), ['DIV-002', 'DIV-001', '00123']);
  assert.equal(writes[3].price, 80);
  assert.deepEqual(audits.map(event => event.action), ['ITEM_CREATE', 'ITEM_CREATE', 'ITEM_CREATE', 'ITEM_UPDATE', 'CATALOGUE_IMPORT']);
});
