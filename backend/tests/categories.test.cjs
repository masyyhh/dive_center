const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Exercise the real Express route and RBAC middleware with an isolated database double.
// No listening server or production database is used.
function loadTypeScript(relativePath, stubs = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => name in stubs ? stubs[name] : require(name), module, module.exports);
  return module.exports;
}
const audit = [];
let categories = [];
const prisma = {
  property: { findUnique: async ({ where }) => ['male', 'ari'].includes(where.id) ? { id: where.id } : null },
  category: {
    aggregate: async ({ where }) => ({ _max: { sortOrder: Math.max(0, ...categories.filter(category => category.propertyId === where.propertyId).map(category => category.sortOrder)) } }),
    create: async ({ data }) => {
      if (categories.some(category => category.propertyId === data.propertyId && category.name === data.name)) throw Object.assign(new Error('Duplicate category'), { code: 'P2002' });
      const category = { id: `category-${categories.length + 1}`, ...data };
      categories.push(category);
      return category;
    },
  },
};
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', {
  '../db': { prisma },
  '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Authentication required.' }) },
  '../middleware/rbac': loadTypeScript('src/middleware/rbac.ts'),
  '../services/auditService': { logAuditEvent: async event => audit.push(event) },
});
const manager = { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['male'] };
function request(body, user = manager) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', url: '/categories', body, user, headers: {}, query: {}, params: {} };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
    itemsRouter.handle(req, res, error => error ? reject(error) : reject(new Error('Route did not respond')));
  });
}
test.beforeEach(() => { categories = []; audit.length = 0; });
test('unauthenticated and centre staff users cannot create categories', async () => {
  assert.equal((await request({ propertyId: 'male', name: 'Dives' }, null)).status, 401);
  assert.equal((await request({ propertyId: 'male', name: 'Dives' }, { ...manager, role: 'CENTRE_STAFF' })).status, 403);
  assert.equal(categories.length, 0);
});
test('property managers cannot create categories for another centre', async () => {
  assert.equal((await request({ propertyId: 'ari', name: 'Dives' })).status, 403);
  assert.equal(categories.length, 0);
});
test('blank names and missing properties do not write data', async () => {
  assert.equal((await request({ propertyId: 'male', name: '   ' })).status, 400);
  assert.equal((await request({ name: 'Dives' })).status, 400);
  const admin = { ...manager, role: 'GLOBAL_ADMIN' };
  assert.equal((await request({ propertyId: 'missing', name: 'Dives' }, admin)).status, 404);
  assert.equal(categories.length, 0);
});
test('a manager can create the first category and it is audited for their property', async () => {
  const result = await request({ propertyId: 'male', name: '  Dives  ' });
  assert.equal(result.status, 201);
  assert.equal(result.body.category.name, 'Dives');
  assert.equal(result.body.category.propertyId, 'male');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].propertyId, 'male');
  assert.equal(audit[0].action, 'CATEGORY_CREATE');
});
test('duplicate categories return a clear conflict without adding or auditing another row', async () => {
  await request({ propertyId: 'male', name: 'Dives' });
  assert.equal((await request({ propertyId: 'male', name: 'Dives' })).status, 409);
  assert.equal(categories.length, 1);
  assert.equal(audit.length, 1);
});
