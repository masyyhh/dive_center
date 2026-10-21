// Disposable CI stack only. This creates fixture accounts and business records.
if (process.env.CI !== 'true' || process.env.SMOKE_TEST !== '1') {
  console.error('This fixture smoke test requires CI=true and SMOKE_TEST=1.');
  process.exit(1);
}
const fs = require('node:fs');
const assert = require('node:assert/strict');
const OTPAuth = require('otpauth');
const base = process.env.SMOKE_API_BASE_URL || 'http://backend:5001/api';
const endpoint = new URL(base);
if (endpoint.protocol !== 'http:' || !['backend', '127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.pathname !== '/api' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
  throw Error('Smoke tests require a local disposable API endpoint.');
}
let token;
async function api(endpoint, method = 'GET', body, expected = 200) {
  const response = await fetch(base + endpoint, {
    method, signal: AbortSignal.timeout(10000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, expected, `${method} ${endpoint} returned unexpected status`);
  if (endpoint.includes('/export/')) {
    assert(response.headers.get('content-type').includes('spreadsheetml'));
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    return;
  }
  return response.json();
}
(async () => {
  await api('/ready');
  await api('/users', 'GET', undefined, 401);
  const password = fs.readFileSync(process.env.ADMIN_PASSWORD_FILE, 'utf8').trim();
  token = (await api('/auth/login', 'POST', { identifier: process.env.ADMIN_EMAIL, password })).token;
  assert(token);
  const setup = await api('/auth/authenticator/setup', 'POST', { password });
  const otp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(setup.secret) }).generate();
  const confirmed = await api('/auth/authenticator/confirm', 'POST', { otp });
  assert.equal(confirmed.recoveryCodes.length, 10);
  const { property } = await api('/properties', 'POST', { name: 'CI fixture', code: 'CI-FIXTURE' }, 201);
  const { categories } = await api(`/items?propertyId=${property.id}`);
  const { item } = await api('/items', 'POST', { propertyId: property.id, categoryId: categories[0].id, code: 'FIXTURE', name: 'Fixture activity', price: 10 }, 201);
  const { staff } = await api('/staff', 'POST', { propertyId: property.id, name: 'CI fixture', roleTitle: 'Instructor', hireDate: '2026-01-01' }, 201);
  await api('/presence/day', 'POST', { propertyId: property.id, date: '2026-10-21', records: [{ staffMemberId: staff.id, status: 'PRESENT' }] });
  const { bill } = await api('/bills', 'POST', { propertyId: property.id, checkNumber: 1, businessDate: '2026-10-21', guestName: 'CI fixture', roomNumber: 'TEST', items: [{ itemId: item.id, itemName: item.name, categoryName: categories[0].name, quantity: 1, unitPrice: 10 }] }, 201);
  assert.equal(bill.items.length, 1);
  await api(`/reports/export/daily?propertyId=${property.id}&date=2026-10-21`);
  await api('/reports/month-lock', 'POST', { propertyId: property.id, yearMonth: '2026-10', lock: true });
  await api('/presence/day', 'POST', { propertyId: property.id, date: '2026-10-21', records: [] }, 423);
  console.log('Container smoke test passed: sign-in, enrollment, property/catalogue, billing, attendance, export and payroll lock.');
})().catch(() => { console.error('Container smoke test failed; inspect fixture-stack logs. No credentials are printed by this tool.'); process.exitCode = 1; });
