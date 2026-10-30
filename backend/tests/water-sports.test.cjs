const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { z } = require('zod');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const database = createTestDatabase('watersports');
const prisma = database.prisma;
const { submissionSchema, signatureSchema } = loadTypeScript('src/services/waterSportsForms.ts');
const signature = [[[10, 20], [100, 40], [150, 90]]];
let property, otherProperty, user, actor, calls;
const noLimit = () => (_req, _res, next) => next();
class PmsLookupError extends Error {}
const { waterSportsRouter } = loadTypeScript('src/routes/water-sports.routes.ts', {
  '../db': { prisma },
  'express-rate-limit': noLimit,
  '../middleware/auth': { requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' }) },
  '../services/pmsService': {
    PmsLookupError, pmsPropertyCodeSchema: z.enum(['VILU', 'SSO', 'OLHU']),
    lookupInhouseGuests: async (code, room) => { calls++; return { guests: [
      { fullName: 'First Guest', roomNumber: room, propertyCode: code, guestType: 'main', checkoutDate: '2026-12-01', arrivalDate: '2026-10-28', confirmationNumber: 'BOOK-111', nationality: 'France', nationalityCode: 'FR' },
      { fullName: 'Second Guest', roomNumber: room, propertyCode: code, guestType: 'sharer', checkoutDate: '2026-12-03', arrivalDate: '2026-10-28', confirmationNumber: 'BOOK-222', nationality: null, nationalityCode: null },
    ] }; },
  },
});
const router = { handle(req, res, next) { res.setHeader = () => {}; waterSportsRouter.handle(req, res, next); } };
const invoke = (method, path, data = {}) => request(router, method, path, { user: actor, ...data });
const staffFields = { checkNumber: '1452', maskNumber: 'M4', finsNumber: 'F6', rentalDuration: '2 days', returnDate: '2099-12-30', notes: 'Reviewed with guest' };
const create = async (formType = 'PARTICIPATION', extra = {}) => {
  const result = await invoke('POST', '/sessions', { body: { propertyId: property.id, formType, roomNumber: '104', staffFields, ...extra } });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
};
const tablet = (session, method, path, body) => invoke(method, '/tablet' + path, { user: null, headers: { authorization: `Bearer ${session.token}` }, body });
const ready = async (type, changes) => {
  const session = await create(type, changes);
  const opened = await tablet(session, 'GET', '');
  const guests = await tablet(session, 'POST', '/guests', { roomNumber: '104' });
  return { session, opened: opened.body, guests: guests.body.guests, payload: { candidateId: guests.body.guests[1].id, documentId: opened.body.documents[0].id, acknowledged: true, isMinor: false, guardianName: '', signature } };
};
test.before(async () => {
  property = await prisma.property.create({ data: { code: 'VILU', name: 'Water sports test', pmsPropertyCodes: ['VILU'] } });
  otherProperty = await prisma.property.create({ data: { code: 'OTHER', name: 'Other centre' } });
  user = await prisma.user.create({ data: { username: 'watersports-test', name: 'Manager', passwordHash: 'unused', role: 'PROPERTY_MANAGER' } });
  actor = { id: user.id, role: 'PROPERTY_MANAGER', assignedPropertyIds: [property.id] };
});
test.beforeEach(() => { calls = 0; });
test.after(() => database.dispose());

test('all four forms use PMS sharer details and staff fields, and persist a signed disclaimer snapshot', async () => {
  let previous = 0;
  for (const type of ['PARTICIPATION', 'SNORKELING', 'GEAR_RENTAL', 'AID_GEAR']) {
    const f = await ready(type);
    assert.equal(f.opened.staffFields.checkNumber, '1452');
    assert.equal('roomNumber' in f.opened, false);
    assert.equal('confirmationNumber' in f.guests[1], false);
    const result = await tablet(f.session, 'POST', '/sign', f.payload);
    assert.equal(result.status, 200);
    assert.ok(result.body.runningNumber > previous); previous = result.body.runningNumber;
    const record = await prisma.waterSportsRecord.findUnique({ where: { sessionId: f.session.id } });
    assert.equal(record.guestName, 'Second Guest'); assert.equal(record.departureDate, '2026-12-03');
    assert.equal(record.confirmationNumber, 'BOOK-222'); assert.equal(record.staffFields.checkNumber, '1452');
    assert.equal(record.documentSnapshot.body, f.opened.documents[0].body);
    assert.equal(record.documentHash, createHash('sha256').update(JSON.stringify(record.documentSnapshot)).digest('hex'));
    assert.deepEqual(record.signature, signature);
    assert.deepEqual((await prisma.waterSportsSession.findUnique({ where: { id: f.session.id } })).candidates, []);
    assert.deepEqual((await tablet(f.session, 'GET', '')).body, { completed: true, runningNumber: previous });
  }
});
test('a minor cannot submit without a guardian, and guest-controlled identity or equipment overrides are rejected', async () => {
  const f = await ready();
  for (const patch of [{ candidateId: randomUUID() }, { documentId: randomUUID() }, { acknowledged: false }, { isMinor: true }, { staffFields: { maskNumber: 'forged' } }, { signature: [] }, { guestName: 'Forged Guest' }]) {
    const result = await tablet(f.session, 'POST', '/sign', { ...f.payload, ...patch });
    assert.equal(result.status, 400, JSON.stringify(patch));
  }
  assert.equal(await prisma.waterSportsRecord.count({ where: { sessionId: f.session.id } }), 0);
  const result = await tablet(f.session, 'POST', '/sign', { ...f.payload, isMinor: true, guardianName: 'Parent Guest' });
  assert.equal(result.status, 200);
  const record = await prisma.waterSportsRecord.findUnique({ where: { sessionId: f.session.id } });
  assert.equal(record.isMinor, true); assert.equal(record.guardianName, 'Parent Guest');
});
test('simultaneous submissions and retries save exactly one running number', async () => {
  const f = await ready();
  const results = await Promise.all(Array.from({ length: 5 }, () => tablet(f.session, 'POST', '/sign', f.payload)));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(new Set(results.map(r => r.body.runningNumber)).size, 1);
  assert.equal(await prisma.waterSportsRecord.count({ where: { sessionId: f.session.id } }), 1);
});
test('tablet links are room-scoped, expire, can be cancelled and cannot expose staff APIs', async () => {
  const f = await create();
  assert.equal((await tablet(f, 'POST', '/guests', { roomNumber: '105' })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await invoke('GET', '/tablet', { user: null })).status, 410);
  assert.equal((await invoke('GET', '/records', { user: null, query: { propertyId: property.id }, headers: { authorization: `Bearer ${f.token}` } })).status, 401);
  await invoke('POST', `/sessions/${f.id}/revoke`, { body: { propertyId: property.id } });
  assert.equal((await tablet(f, 'GET', '')).status, 410);
  const expired = await create();
  await prisma.waterSportsSession.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await tablet(expired, 'POST', '/guests', { roomNumber: '104' })).status, 410);
  const limited = await create();
  await prisma.waterSportsSession.update({ where: { id: limited.id }, data: { lookupCount: 10 } });
  assert.equal((await tablet(limited, 'POST', '/guests', { roomNumber: '104' })).status, 429);
  assert.equal(calls, 0);
});
test('PMS lookup selection is replaced on search and old candidate IDs cannot be signed', async () => {
  const f = await ready();
  await tablet(f.session, 'POST', '/guests', { roomNumber: '104' });
  assert.equal((await tablet(f.session, 'POST', '/sign', f.payload)).status, 400);
});
test('published translations are selectable, versioned and pinned to links and signed records', async () => {
  const before = await ready('SNORKELING');
  const publish = text => invoke('POST', '/documents', { body: { propertyId: property.id, kind: 'SNORKELING', language: 'fr', languageName: 'Français', title: 'Décharge plongée libre', body: text.repeat(20) } });
  const first = await publish('Première version de la décharge. ');
  assert.equal(first.status, 201);
  const after = await ready('SNORKELING');
  const french = after.opened.documents.find(d => d.language === 'fr');
  assert.equal(french.id, first.body.id);
  await publish('Deuxième version de la décharge. ');
  assert.notEqual(before.opened.documents.find(d => d.language === 'fr').id, first.body.id);
  const signed = await tablet(after.session, 'POST', '/sign', { ...after.payload, documentId: french.id });
  assert.equal(signed.status, 200);
  const stored = await prisma.waterSportsRecord.findUnique({ where: { sessionId: after.session.id } });
  assert.equal(stored.documentSnapshot.body, french.body);
  assert.equal(stored.documentSnapshot.language, 'fr');
  const latest = await invoke('GET', '/documents', { query: { propertyId: property.id, kind: 'SNORKELING' } });
  assert.match(latest.body.documents.find(d => d.language === 'fr').body, /Deuxième/);
});
test('property access, manager publishing and required rental details are enforced', async () => {
  assert.equal((await invoke('GET', '/records', { query: { propertyId: otherProperty.id } })).status, 403);
  const f = await ready(); const signed = await tablet(f.session, 'POST', '/sign', f.payload);
  const record = await prisma.waterSportsRecord.findUnique({ where: { sessionId: f.session.id } });
  assert.equal((await invoke('GET', `/records/${record.id}`, { query: { propertyId: otherProperty.id }, user: { ...actor, assignedPropertyIds: [otherProperty.id] } })).status, 404);
  const detail = await invoke('GET', `/records/${record.id}`, { query: { propertyId: property.id } });
  assert.equal(detail.body.runningNumber, signed.body.runningNumber);
  assert.equal((await invoke('POST', '/documents', { user: { ...actor, role: 'CENTRE_STAFF' }, body: { propertyId: property.id } })).status, 403);
  for (const formType of ['GEAR_RENTAL', 'AID_GEAR']) {
    assert.equal((await invoke('POST', '/sessions', { body: { propertyId: property.id, formType, roomNumber: '104', staffFields: {} } })).status, 400);
  }
});
test('signature validation rejects invisible marks, huge strokes and missing age declarations', () => {
  for (const invalid of [[], [[]], [[[0, 0]]], [[[10, 10], [10, 10]]], [[[0, 0], [1001, 0]]], Array.from({ length: 51 }, () => [[0, 0], [100, 100]])]) assert.equal(signatureSchema.safeParse(invalid).success, false);
  assert.equal(submissionSchema.safeParse({ candidateId: randomUUID(), documentId: randomUUID(), acknowledged: true, signature }).success, false);
});

test('both disclaimers offer all six requested languages with complete conditions and stable versions', () => {
  const { defaultDisclaimerDocuments } = loadTypeScript('src/services/waterSportsForms.ts');
  const ids = new Set();
  for (const kind of ['PARTICIPATION', 'SNORKELING']) {
    const docs = defaultDisclaimerDocuments(kind);
    assert.deepEqual(docs.map(d => d.language), ['en', 'de', 'fr', 'ru', 'zh-CN', 'ar', 'it']);
    for (const d of docs) {
      assert.ok(d.title.length > 5);
      assert.ok(d.body.length > 200);
      assert.match(d.id, /^[a-f0-9-]{36}$/);
      assert.equal(ids.has(d.id), false); ids.add(d.id);
      if (kind === 'PARTICIPATION') {
        assert.deepEqual([...d.body.matchAll(/^(\d+)\./gm)].map(m => Number(m[1])), Array.from({ length: 17 }, (_, i) => i + 1));
        assert.ok((d.body.match(/40[.,]00/g) || []).length === 3, d.language + ' retains all three fee clauses');
      } else {
        assert.equal((d.body.match(/^•/gm) || []).length, 3);
      }
      assert.match(d.body, /18/);
    }
  }
  assert.equal(defaultDisclaimerDocuments('PARTICIPATION')[0].id, 'a0000000-0000-4000-8000-000000000001');
  assert.equal(defaultDisclaimerDocuments('SNORKELING')[1].id, 'a0000000-0000-4000-8000-000000000012');
});

test('every requested language survives the tablet-to-signed-record flow without modifying manual Check No.', async () => {
  for (const type of ['PARTICIPATION', 'SNORKELING']) {
    for (const language of ['ru', 'zh-CN', 'fr', 'ar', 'it', 'de']) {
      const f = await ready(type);
      const document = f.opened.documents.find(d => d.language === language);
      assert.ok(document, language);
      const signed = await tablet(f.session, 'POST', '/sign', { ...f.payload, documentId: document.id });
      assert.equal(signed.status, 200, language);
      const record = await prisma.waterSportsRecord.findUnique({ where: { sessionId: f.session.id } });
      assert.equal(record.documentSnapshot.language, language);
      assert.equal(record.documentSnapshot.body, document.body);
      assert.equal(record.staffFields.checkNumber, '1452');
      assert.equal(record.confirmationNumber, 'BOOK-222');
    }
  }
});
