import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/diveCentreJourney.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { signatureHasInk, remainingMinutes, guestTokenFromHash, disclaimerReadiness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const noticeSource = await readFile(new URL('../src/utils/documentNotice.ts', import.meta.url), 'utf8');
const noticeCompiled = ts.transpileModule(noticeSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { electronicDocumentNotice } = await import(`data:text/javascript;base64,${Buffer.from(noticeCompiled).toString('base64')}`);
test('guest cannot submit an empty signature or an invisible tap', () => {
  for (const strokes of [[], [[]], [[[10,10]]], [[[10,10],[10,10]]], [[[10,10],[12,12]]]]) assert.equal(signatureHasInk(strokes), false);
  assert.equal(signatureHasInk([[[10,10],[16,10]]]), true);
  assert.equal(signatureHasInk(Array.from({ length: 51 }, () => [[10,10],[16,10]])), false);
});
test('guest link countdown handles expiry and missing dates without negative values', () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  assert.equal(remainingMinutes('2026-11-02T10:20:00Z', now),20);
  assert.equal(remainingMinutes('2026-11-02T10:00:01Z', now),1);
  assert.equal(remainingMinutes('2026-11-02T10:00:00Z', now),0);
  assert.equal(remainingMinutes('2026-11-02T09:00:00Z', now),0);
  assert.equal(remainingMinutes(undefined, now),null);
  assert.equal(remainingMinutes('invalid', now),null);
});

test('new and already-issued guest links resolve the same scoped capability', () => {
  const token = 'a'.repeat(64);
  assert.equal(guestTokenFromHash('#dive-centre-tablet/' + token),token);
  assert.equal(guestTokenFromHash('#water-sports-tablet/' + token),token);
  for (const invalid of ['#dive-centre-tablet/short','#dive-centre-tablet/' + token + '/other','#dive-centre','#water-sports']) assert.equal(guestTokenFromHash(invalid),undefined);
});

test('preparation accepts fictional guests without PMS mapping, while live lookup and document requirements remain enforced', () => {
  const overview = (testingGuests, pmsPropertyConfigured, documents = { DIVE_PARTICIPATION: 1 }) => ({ testingGuests, readiness: { pmsPropertyConfigured, documents } });
  const ready = { guestLookupReady: true, documentReady: true, canPrepare: true };
  assert.deepEqual(disclaimerReadiness(overview(true, false), 'DIVE_PARTICIPATION'), ready);
  assert.deepEqual(disclaimerReadiness(overview(false, true), 'DIVE_PARTICIPATION'), ready);
  for (const state of [overview(false, false), overview(undefined, false), overview(true, false, {}), overview(false, true, { DIVE_PARTICIPATION: 0 }), null]) {
    assert.equal(disclaimerReadiness(state, 'DIVE_PARTICIPATION').canPrepare, false);
  }
  assert.equal(disclaimerReadiness(overview(true, false), 'GEAR_RENTAL').canPrepare, false);
});

test('the rendered Create guest link button follows testing lookup readiness', async () => {
  const React = await import('react');
  const jsxRuntime = await import('react/jsx-runtime');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const component = await readFile(new URL('../src/components/DisclaimerView.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(component.replaceAll('import.meta.env.VITE_DEPLOYMENT_MODE', JSON.stringify('live')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  for (const [testingGuests, mapped, documents, disabled] of [[true, false, 1, false], [false, true, 1, false], [false, false, 1, true], [true, false, 0, true]]) {
    let injected = false;
    const overview = { testingGuests, pendingCount: 0, signedToday: 0, totalSigned: 0, readiness: { pmsPropertyConfigured: mapped, documents: { DIVE_PARTICIPATION: documents } } };
    const hooks = { ...React.default, useEffect: () => {}, useState: value => {
      if (value === null && !injected) { injected = true; return [overview, () => {}]; }
      return [value, () => {}];
    } };
    const stubs = {
      react: hooks,
      'react/jsx-runtime': jsxRuntime,
      '../utils/diveCentreJourney': { disclaimerReadiness },
      '../utils/documentNotice': { electronicDocumentNotice },
      '../utils/inputValidation': { isRoomNumber: value => /^[0-9]+$/.test(value), roomNumberHelp: 'Digits only' },
      '../services/api': {},
      '../context/PropertyContext': { useProperty: () => ({ activeProperty: { id: 'test' } }) },
      '../context/AuthContext': { useAuth: () => ({ user: { role: 'PROPERTY_MANAGER' } }) },
      '../context/NavigationContext': { useUnsavedChanges: () => {} },
      './DisclaimerShared': { formNames: { DIVE_PARTICIPATION: 'Diving participation' } },
      './disclaimer.css': {},
      './TableScroll': { TableScroll: ({ children }) => React.createElement('div', null, children) },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', js)(name => {
      if (!(name in stubs)) throw Error('Unexpected component dependency: ' + name);
      return stubs[name];
    }, module, module.exports);
    const html = renderToStaticMarkup(module.exports.DisclaimerView());
    const button = html.match(/<button\b([^>]*)>Create guest link<\/button>/);
    assert.ok(button);
    assert.equal(button[1].includes('disabled'), disabled, JSON.stringify({ testingGuests, mapped, documents }));
    assert.equal(html.includes('Fictional guest lookup ready'), testingGuests);
  }
});
