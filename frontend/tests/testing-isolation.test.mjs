import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function load(path, mode) {
  const source = (await readFile(new URL(path, import.meta.url), 'utf8')).replaceAll('import.meta.env?.VITE_DEPLOYMENT_MODE', JSON.stringify(mode));
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const live = await load('../src/services/api.ts', 'live');
const testing = await load('../src/services/api.ts', 'testing');
test('live and testing tabs retain independent tokens and selected properties', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  live.setAuthToken('live-token'); live.setStoredPropertyId('live-property');
  assert.equal(testing.getAuthToken(), null); assert.equal(testing.getStoredPropertyId(), null);
  testing.setAuthToken('test-token'); testing.setStoredPropertyId('test-property');
  assert.equal(live.getAuthToken(), 'live-token'); assert.equal(live.getStoredPropertyId(), 'live-property');
  assert.equal(testing.getAuthToken(), 'test-token'); assert.equal(testing.getStoredPropertyId(), 'test-property');
  testing.setAuthToken(null); testing.setStoredPropertyId(null);
  assert.equal(live.getAuthToken(), 'live-token'); assert.equal(live.getStoredPropertyId(), 'live-property');
});
test('testing requests, logout and report downloads cannot fall back to the live API', async () => {
  const store = new Map([['dcm_auth_token', 'live-token'], ['dcm_testing_auth_token', 'test-token'], ['dcm_testing_active_property_id', 'test-property']]);
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, removeItem: key => store.delete(key) };
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, ...options }); return { ok: true, json: async () => ({}), blob: async () => new Blob(['test']) }; };
  globalThis.document = { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) };
  globalThis.window = { URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } };
  await testing.apiFetch('/bills', { method: 'POST', body: '{}' });
  await testing.downloadFile('/reports/export', 'test.xlsx');
  await testing.revokeSession();
  assert.deepEqual(requests.map(request => request.url), ['/__testing/api/bills', '/__testing/api/reports/export', '/__testing/api/auth/logout']);
  assert(requests.every(request => request.headers.Authorization === 'Bearer test-token' && request.headers['X-Property-Id'] === 'test-property'));
  assert.equal(store.get('dcm_auth_token'), 'live-token'); assert.equal(store.has('dcm_testing_auth_token'), false);
});
test('identical account and property IDs cannot restore a live bill draft in testing', async () => {
  const liveDraft = await load('../src/utils/billDraft.ts', 'live');
  const testingDraft = await load('../src/utils/billDraft.ts', 'testing');
  assert.equal(liveDraft.billDraftKey('user', 'property'), 'dcm_bill_draft:user:property');
  assert.equal(testingDraft.billDraftKey('user', 'property'), 'dcm_testing_bill_draft:user:property');
});
test('connecting explicitly exchanges only the live token and does not replace or clear live credentials', async () => {
  const store = new Map([['dcm_auth_token', 'live-token'], ['dcm_testing_auth_token', 'old-test-token']]);
  globalThis.localStorage = { getItem: key => store.get(key) ?? null };
  let call;
  globalThis.fetch = async (url, options) => { call = { url, ...options }; return { ok: true, json: async () => ({ token: 'new-test-token', user: { id: 'live:user' } }) }; };
  const result = await testing.connectTestingLiveSignIn();
  assert.equal(call.url, '/__testing/api/auth/live-session');
  assert.deepEqual(JSON.parse(call.body), { liveToken: 'live-token' });
  assert.equal(result.token, 'new-test-token'); assert.equal(store.get('dcm_auth_token'), 'live-token');
  await assert.rejects(live.connectTestingLiveSignIn(), /testing version/);
  store.delete('dcm_auth_token');
  await assert.rejects(testing.connectTestingLiveSignIn(), /Sign in to the live version/);
});
