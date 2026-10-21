const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const keyNames = ['PMS_API_KEY', 'PMS_API_KEY_FILE'];
const original = Object.fromEntries(keyNames.map(key => [key, process.env[key]]));
const guest = (name, booking, date, extra = {}) => ({ propertyCode: 'OLHU', roomNumber: '104', guestType: booking === '1' ? 'main' : 'sharer', fullName: name, firstName: name, lastName: '', nationality: 'India', nationalityCode: 'IN', checkoutDate: date, arrivalDate: '2026-10-17', confirmationNumber: booking, ...extra });
const data = [guest('Test Main', '1', '2026-10-21'), guest('Test Sharer', '2', '2026-10-24'), guest('Test Other', '3', '2026-10-26', { nationality: null })];
const reply = (guests = data, extra = {}) => ({ property_code: 'OLHU', room_number: '104', searched_properties: ['OLHU', 'SSO'], count: guests.length, data: guests, ...extra });
const actor = { id: 'staff', role: 'CENTRE_STAFF', assignedPropertyIds: ['own'] };
function fixture(responses = [new Response(JSON.stringify(reply()), { status: 200, headers: { 'X-Request-ID': 'fixture-request-123' } })]) {
  const calls = [], properties = [];
  const fetch = async (url, options) => { calls.push({ url: url.toString(), options }); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) throw Error('Unexpected call'); return next; };
  const prisma = { property: { findUnique: async ({ where }) => { properties.push(where); return where.id === 'own' ? { code: 'DIVE-CENTRE', pmsPropertyCode: 'OLHU', isActive: true } : null; } } };
  const logs = [];
  const { guestsRouter } = loadTypeScript('src/routes/guests.routes.ts', {
    '../db': { prisma },
    '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) },
    '../middleware/security': { pmsLookupLimiter: (_req, _res, next) => next() },
  }, { fetch, console: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  const query = (changes = {}, user = actor) => request(guestsRouter, 'GET', '/inhouse', { query: { propertyId: 'own', roomNumber: '104', ...changes }, user });
  return { query, calls, properties, prisma, logs };
}
test.beforeEach(() => { process.env.PMS_API_KEY = 'private-pms-key'; delete process.env.PMS_API_KEY_FILE; });
test.after(() => { for (const key of keyNames) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } });

test('room lookup returns every guest with their own departure date and server-only key', async () => {
  const f = fixture(); const result = await f.query({ propertyCode: 'AQUA' });
  assert.equal(result.status, 200); assert.equal(result.body.count, 3);
  assert.deepEqual(result.body.guests.map(g => g.checkoutDate), ['2026-10-21', '2026-10-24', '2026-10-26']);
  assert.equal(result.body.guests[2].nationality, null);
  const url = new URL(f.calls[0].url);
  assert.equal(url.origin, 'https://pmsapi.ssrsys.com');
  assert.equal(url.pathname, '/api/v1/inhouse/guests');
  assert.equal(url.searchParams.get('property_code'), 'OLHU');
  assert.equal(url.searchParams.get('room_number'), '104');
  assert.equal(f.calls[0].options.headers['X-API-Key'], 'private-pms-key');
  assert.equal(f.calls[0].options.redirect, 'error');
  assert.equal(result.body.requestId, 'fixture-request-123');
  assert.equal(JSON.stringify([result.body, f.logs]).includes('private-pms-key'), false);
  assert.equal(JSON.stringify(f.logs).includes('Test Main'), false);
});
test('unauthenticated and foreign-property requests never contact PMS; invalid queries cause no lookup', async () => {
  const f = fixture();
  assert.equal((await f.query({}, null)).status, 401);
  assert.equal((await f.query({ propertyId: 'foreign' })).status, 403);
  for (const query of [{ propertyId: ['own'] }, { roomNumber: '' }, { roomNumber: ['104', '105'] }, { roomNumber: '104\n105' }, { roomNumber: 'a'.repeat(33) }]) assert.equal((await f.query(query)).status, 400);
  assert.equal(f.calls.length, 0);
});
test('missing key, missing mapping, inactive properties and unknown properties cause no external call', async () => {
  const f = fixture();
  delete process.env.PMS_API_KEY;
  assert.equal((await f.query()).status, 503);
  process.env.PMS_API_KEY = 'private-pms-key';
  f.prisma.property.findUnique = async () => ({ code: 'DIVE-CENTRE', pmsPropertyCode: null, isActive: true });
  assert.equal((await f.query()).status, 409);
  f.prisma.property.findUnique = async () => ({ code: 'OLHU', isActive: false });
  assert.equal((await f.query()).status, 404);
  f.prisma.property.findUnique = async () => null;
  assert.equal((await f.query()).status, 404);
  assert.equal(f.calls.length, 0);
});
test('a supported centre code works as the mapping and an empty room is a normal result', async () => {
  const f = fixture([new Response(JSON.stringify(reply([])), { status: 200 })]);
  f.prisma.property.findUnique = async () => ({ code: 'OLHU', pmsPropertyCode: null, isActive: true });
  const result = await f.query();
  assert.equal(result.status, 200); assert.deepEqual(result.body.guests, []); assert.equal(result.body.count, 0);
});
test('OLHU can return SSO sharers but unrelated resorts and mismatched rooms are rejected', async () => {
  const f = fixture([new Response(JSON.stringify(reply([guest('SSO Test', '1', '2026-10-22', { propertyCode: 'SSO' })])), { status: 200 })]);
  assert.equal((await f.query()).status, 200);
  for (const patch of [{ propertyCode: 'AQUA' }, { roomNumber: '105' }, { checkoutDate: '2026-02-30' }]) {
    const fixtureWithBad = fixture([new Response(JSON.stringify(reply([guest('Bad', '1', '2026-10-22', patch)])), { status: 200 })]);
    assert.equal((await fixtureWithBad.query()).status, 502);
  }
  const badRoot = fixture([new Response(JSON.stringify(reply(data, { property_code: 'AQUA' })), { status: 200 })]);
  assert.equal((await badRoot.query()).status, 502);
});
test('upstream errors expose a safe request reference and never expose raw provider errors', async () => {
  for (const [upstream, expected] of [[401, 502], [403, 502], [422, 502], [429, 429]]) {
    const f = fixture([new Response(JSON.stringify({ detail: 'private-pms-key Test Main' }), { status: upstream, headers: { 'X-Request-ID': 'request-456' } })]);
    const result = await f.query();
    assert.equal(result.status, expected); assert.equal(result.body.requestId, 'request-456');
    assert.equal(JSON.stringify([result.body, f.logs]).includes('private-pms-key'), false);
    assert.equal(JSON.stringify([result.body, f.logs]).includes('Test Main'), false);
    assert.equal(f.calls.length, 1);
  }
});
test('a 503 retries once; repeated 503, malformed JSON, and connection errors stay actionable', async () => {
  const success = fixture([new Response('{}', { status: 503 }), new Response(JSON.stringify(reply()), { status: 200 })]);
  assert.equal((await success.query()).status, 200); assert.equal(success.calls.length, 2);
  const failure = fixture([new Response('{}', { status: 503 }), new Response('{}', { status: 503 })]);
  assert.equal((await failure.query()).status, 503); assert.equal(failure.calls.length, 2);
  assert.equal((await fixture([new Response('not json', { status: 200 })]).query()).status, 502);
  assert.equal((await fixture([new Error('private key or host detail')]).query()).status, 503);
});
