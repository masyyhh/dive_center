const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const names = ['DISCLAIMER_TEST_GUESTS', 'APP_DEPLOYMENT_MODE', 'TESTING_LIVE_AUTH'];
const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
const secrets = { DATABASE_URL: 'postgresql://dive_center_testing:private@db:5432/dive_center_testing', PMS_API_KEY: '' };
const service = loadTypeScript('src/services/disclaimerTesting.ts', {
  '../config/secrets': { readSecret: name => secrets[name] || '' },
});
test.beforeEach(() => {
  process.env.DISCLAIMER_TEST_GUESTS = 'true';
  process.env.APP_DEPLOYMENT_MODE = 'testing';
  process.env.TESTING_LIVE_AUTH = 'false';
  secrets.DATABASE_URL = 'postgresql://dive_center_testing:private@db:5432/dive_center_testing';
  secrets.PMS_API_KEY = '';
});
test.after(() => { for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; } });
test('fictional guests are off by default', () => {
  delete process.env.DISCLAIMER_TEST_GUESTS;
  assert.equal(service.disclaimerTestGuestsEnabled(), false);
  assert.throws(() => service.disclaimerTestGuests('0012'), /disabled/);
});
test('live deployment, live datasource, alternate role/host and live integrations cannot activate fictional guests', () => {
  for (const mode of [undefined, 'live', 'production']) {
    if (mode === undefined) delete process.env.APP_DEPLOYMENT_MODE; else process.env.APP_DEPLOYMENT_MODE = mode;
    assert.throws(() => service.disclaimerTestGuestsEnabled(), /standalone testing/);
  }
  process.env.APP_DEPLOYMENT_MODE = 'testing';
  for (const url of ['postgresql://dive_center:private@db/dive_center', 'postgresql://dive_center_testing:private@db/dive_center', 'postgresql://dive_center:private@db/dive_center_testing', 'postgresql://dive_center_testing:private@production/dive_center_testing', 'https://dive_center_testing:private@db/dive_center_testing', 'invalid']) {
    secrets.DATABASE_URL = url;
    assert.throws(() => service.disclaimerTestGuestsEnabled(), /testing database|standalone testing/);
  }
  secrets.DATABASE_URL = 'postgresql://dive_center_testing:private@db/dive_center_testing';
  secrets.PMS_API_KEY = 'live-key';
  assert.throws(() => service.disclaimerTestGuestsEnabled(), /disabled live integrations/);
  secrets.PMS_API_KEY = '';
  process.env.TESTING_LIVE_AUTH = 'true';
  assert.throws(() => service.disclaimerTestGuestsEnabled(), /disabled live integrations/);
});
test('test rooms preserve leading zeros, expose fictional identities and leave all other rooms empty', () => {
  assert.equal(service.disclaimerTestGuestsEnabled(), true);
  const guests = service.disclaimerTestGuests('0012');
  assert.equal(guests.length, 2);
  assert.deepEqual(guests.map(g => g.guestType), ['main', 'sharer']);
  for (const guest of guests) {
    assert.equal(guest.roomNumber, '0012');
    assert.match(guest.fullName, /^TEST ONLY/);
    assert.match(guest.confirmationNumber, /^DISCLAIMER-TEST-/);
    assert.ok(guest.checkoutDate > guest.arrivalDate);
  }
  assert.match(service.disclaimerTestGuests('0013')[0].fullName, /Child/);
  for (const room of ['12', '104', '0014', 'A101', '']) assert.deepEqual(service.disclaimerTestGuests(room), []);
});
