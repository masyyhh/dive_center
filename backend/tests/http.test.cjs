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
