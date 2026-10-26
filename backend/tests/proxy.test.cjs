const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const { configureProxySecurity } = loadTypeScript('src/middleware/proxy.ts');

test('published API requires explicit, bounded proxy addresses', () => {
  assert.throws(() => configureProxySecurity(express(), { REQUIRE_TRUSTED_PROXY: '1' }), /required/);
  for (const value of ['', 'true', '1', 'uniquelocal', '0.0.0.0/0', '::/0', '10.0.0.1/33', '::1/129', '10.0.0.1/-1', '10.0.0.1/24/1', '10.0.0.1,']) {
    assert.throws(() => configureProxySecurity(express(), { TRUST_PROXY_ADDRESSES: value }), /explicit proxy/);
  }
  for (const value of ['10.0.0.10', '10.0.0.0/24,2001:db8::1/128', '::1']) {
    assert.doesNotThrow(() => configureProxySecurity(express(), { REQUIRE_TRUSTED_PROXY: '1', TRUST_PROXY_ADDRESSES: value }));
  }
});

async function fixture(t, addresses, extra = {}) {
  const app = express();
  configureProxySecurity(app, { REQUIRE_TRUSTED_PROXY: '1', TRUST_PROXY_ADDRESSES: addresses, ...extra });
  app.get('/api/health', (_req, res) => res.json({ status: 'healthy' }));
  app.get('/api/ready', (_req, res) => res.json({ status: 'ready' }));
  app.all('/api/private', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));
  app.post('/api/health', (_req, res) => res.sendStatus(204));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('untrusted peers cannot bypass the proxy gate with forged headers', async t => {
  const origin = await fixture(t, '192.0.2.10');
  const headers = { 'X-Forwarded-For': '192.0.2.10', 'X-Forwarded-Proto': 'https' };
  const denied = await fetch(`${origin}/api/private`, { headers });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  for (const path of ['/api/health', '/api/ready']) assert.equal((await fetch(`${origin}${path}`)).status, 200);
  assert.equal((await fetch(`${origin}/api/health`, { method: 'POST', headers })).status, 403);
});

test('temporary open access ignores forged forwarded headers and uses the actual peer', async t => {
  const origin = await fixture(t, undefined, { REQUIRE_TRUSTED_PROXY: '0', TRUST_PROXY: '0' });
  const response = await fetch(`${origin}/api/private`, {
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.99' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ip: '127.0.0.1', protocol: 'http' });
});

test('trusted proxies must report HTTPS and preserve the nearest untrusted client address', async t => {
  const origin = await fixture(t, '127.0.0.1/32');
  for (const protocol of [undefined, 'http', 'invalid']) {
    const headers = protocol ? { 'X-Forwarded-Proto': protocol } : {};
    assert.equal((await fetch(`${origin}/api/private`, { headers })).status, 403);
  }
  const response = await fetch(`${origin}/api/private`, {
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.99, 192.0.2.20' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ip: '192.0.2.20', protocol: 'https' });
});
