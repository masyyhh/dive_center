// Used only by test-parallel-testing.sh inside a disposable CI installation.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const headers = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.25' };
const base = 'http://web:8080';
(async () => {
  const live = await fetch(base, { headers });
  assert.equal(live.status, 200);
  const html = await live.text();
  const digest = createHash('sha256').update(html).digest('hex');
  if (process.env.PROBE_MODE === 'baseline') { console.log(digest); return; }
  assert.equal(digest, process.env.LIVE_HTML_DIGEST, 'original live HTML must remain byte-for-byte identical');
  assert.equal((await fetch(`${base}/api/ready`, { headers })).status, 200);
  if (process.env.PROBE_MODE === 'unavailable') {
    const response = await fetch(`${base}/__testing/api/ready`, { headers });
    assert(response.status >= 500, 'a stopped testing service must fail instead of falling back to live');
    return;
  }
  if (process.env.PROBE_MODE === 'stopped') {
    assert.equal((await fetch(`${base}/?version=testing`, { headers })).headers.get('X-App-Version'), null);
    return;
  }
  for (const path of ['/?version=testing', '/__testing/api/ready', '/?version=choose']) {
    assert.equal((await fetch(`${base}${path}`)).status, 403, 'forwarded HTTPS is required for all version routes');
  }
  const chooser = await fetch(`${base}/?version=choose`, { headers });
  assert.equal(chooser.status, 200); assert.match(await chooser.text(), /Choose a version/);
  const preview = await fetch(`${base}/?version=testing`, { headers });
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('X-App-Version'), 'testing');
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  const previewHtml = await preview.text();
  const assets = [...previewHtml.matchAll(/(?:src|href)="(\/__testing\/assets\/[^"?]+)"/g)].map(match => match[1]);
  assert(assets.some(asset => asset.endsWith('.js')));
  for (const asset of assets) {
    const response = await fetch(`${base}${asset}`, { headers }); assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-App-Version'), 'testing');
  }
  const ready = await fetch(`${base}/__testing/api/ready`, { headers });
  assert.equal(ready.status, 200); assert.equal(ready.headers.get('X-App-Version'), 'testing');
  assert.equal((await fetch(`${base}/__testing/api/users`, { headers })).status, 401);
  assert.equal((await fetch(`${base}/api/users`, { headers })).status, 401);
  console.log('Parallel routing: frozen live HTML retained; test entry/assets/API isolated; HTTPS checks retained.');
})().catch(error => { console.error(error); process.exitCode = 1; });
