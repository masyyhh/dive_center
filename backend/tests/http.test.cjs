const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { loadTypeScript } = require('./helpers/runtime.cjs');

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.CORS_ORIGIN = 'https://dive.example.test';
process.env.TRUST_PROXY = '1';
delete process.env.JWT_SECRET_FILE;
let databaseAvailable = true;
const auditEntries = [];
const prisma = { auditLog: { create: async ({ data }) => { auditEntries.push(data); return data; } }, $queryRaw: async () => { if (!databaseAvailable) throw new Error('Private database connection details'); return [{ value: 1 }]; } };
const { default: app } = loadTypeScript('src/app.ts', { './db': { prisma }, '../db': { prisma } });
let server, origin;
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });

test('production HTTP health, readiness, security headers, and unauthenticated API protection', async () => {
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('x-powered-by'), null);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${origin}/api/ready`)).status, 200);
  assert.equal((await fetch(`${origin}/api/users`)).status, 401);
  databaseAvailable = false;
  const unavailable = await fetch(`${origin}/api/ready`);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes('Private'), false);
  databaseAvailable = true;
});
test('only the configured frontend origin receives CORS permission', async () => {
  const allowed = await fetch(`${origin}/api/health`, { headers: { Origin: process.env.CORS_ORIGIN } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), process.env.CORS_ORIGIN);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
  const denied = await fetch(`${origin}/api/health`, { headers: { Origin: 'https://untrusted.example.test' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('HTTP audit records request outcomes and access times while omitting query secrets', async () => {
  const before = auditEntries.length;
  const response = await fetch(`${origin}/api/audit?secret=private-value`);
  assert.equal(response.status, 401);
  const entry = auditEntries.slice(before).find(entry => entry.action === 'API_REQUEST');
  assert(entry);
  assert.equal(entry.propertyId, null);
  const details = JSON.parse(entry.details);
  assert.equal(details.path, '/api/audit');
  assert.equal(details.status, 401);
  assert.equal(details.method, 'GET');
  assert(!Number.isNaN(Date.parse(details.startedAt)));
  assert(!entry.details.includes('private-value'));
});

test('requests rejected by the API limiter stop writing database audit rows', async () => {
  const headers = { 'X-Forwarded-For': '192.0.2.80' };
  // Health requests consume the real limiter budget without producing audit rows.
  for (let i = 0; i < 1000; i++) {
    const response = await fetch(`${origin}/api/health`, { headers });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  const before = auditEntries.length;
  for (const path of ['/api/users', '/api/nonexistent', '/api/audit?secret=omitted']) {
    const response = await fetch(`${origin}${path}`, { headers });
    assert.equal(response.status, 429);
    await response.arrayBuffer();
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auditEntries.length, before);
  // An admitted request from another client must still be audited.
  assert.equal((await fetch(`${origin}/api/users`, { headers: { 'X-Forwarded-For': '192.0.2.81' } })).status, 401);
  assert.equal(auditEntries.length, before + 1);
});

test('rejecting an amplified workbook leaves ordinary API requests responsive', async () => {
  const ExcelJS = require('exceljs');
  const JSZip = require('jszip');
  const { parseCatalogue, catalogueHeaders } = loadTypeScript('src/services/catalogueTransfer.ts');
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Catalogue');
  sheet.addRow(catalogueHeaders); sheet.addRow(['', 'Boat dive', 'Diving', 75, 10, 'Active']);
  const archive = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  archive.file('unused.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  const content = (await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })).toString('base64');
  const rejected = assert.rejects(parseCatalogue(content, 'xlsx'), /expanded data limit/);
  const response = await fetch(`${origin}/api/health`, { headers: { 'X-Forwarded-For': '192.0.2.82' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'healthy');
  await rejected;
  const valid = Buffer.from('Item Code,Items,Category,Price,Commission,Status\n,Boat dive,Diving,75,10,Active').toString('base64');
  assert.equal((await parseCatalogue(valid, 'csv')).length, 1);
});

test('compressed JSON and form bodies reject before routing and leave the API alive', async () => {
  const zlib = require('node:zlib');
  for (const [type, content] of [['application/json', '{}'], ['application/x-www-form-urlencoded', 'a=b']]) {
    for (const encoding of ['gzip', 'deflate']) {
      const bytes = encoding === 'gzip' ? zlib.gzipSync(content) : zlib.deflateSync(content);
      const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': type, 'Content-Encoding': encoding }, body: bytes });
      assert.equal(response.status, 415);
    }
  }
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
});

test('raw input budgets reject wide/nested requests without breaking catalogue envelopes', async () => {
  for (const body of [{ records: Array.from({ length: 8000 }, () => ({})) }, Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`key${i}`, true]))]) {
    const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /too many/);
  }
  const response = await fetch(`${origin}/api/items/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: 'fixture', content: 'A'.repeat(4 * 1024 * 1024), format: 'csv' }) });
  // The normal auth gate is reached; the upload envelope was not truncated/rejected.
  assert.equal(response.status, 401);
});
