import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const people = [{ id: 'staff-1', name: 'Instructor One' }];
const nodes = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(nodes) : !React.isValidElement(node) ? [] : [node, ...nodes(node.props.children)];
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : '';
function fixture(staffResponse) {
  const values = [], refs = [], effects = [], seenEffects = [], calls = [];
  let state = 0, ref = 0, effect = 0;
  const hooks = { ...React,
    useState(initial) { const i = state++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
    useRef(initial) { const i = ref++; return refs[i] ??= { current: initial }; },
    useCallback(callback) { return callback; },
    useEffect(callback) { const i = effect++; if (!seenEffects[i]) { seenEffects[i] = true; effects.push(callback); } },
  };
  const AssignmentForm = () => null;
  const source = readFileSync(new URL('../src/components/EquipmentView.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => {
    if (name === 'react') return hooks;
    if (name.endsWith('AuthContext')) return { useAuth: () => ({ user: { role: 'PROPERTY_MANAGER' } }) };
    if (name.endsWith('PropertyContext')) return { useProperty: () => ({ activeProperty: { id: 'property-1', name: 'Siyam World', currency: 'USD' } }) };
    if (name.endsWith('NavigationContext')) return { useUnsavedChanges() {}, useNavigation: () => ({ requestNavigation: action => action() }) };
    if (name.endsWith('services/api')) return { apiFetch: async url => {
      calls.push(url);
      if (url.startsWith('/staff?')) return staffResponse;
      if (url.startsWith('/equipment/inventory?')) return [];
      if (url.startsWith('/equipment/rentals?')) return { rentals: [], nextCursor: null };
      throw Error('Unexpected request: ' + url);
    } };
    if (name.endsWith('utils/dates')) return { businessToday: () => '2026-11-09' };
    if (name.endsWith('equipment/AssignmentForm')) return { AssignmentForm };
    if (name.endsWith('equipment/types')) return { statusText: value => value, money: () => '$0.00' };
    if (name.startsWith('.')) return new Proxy({}, { get: () => () => null });
    return require(name);
  }, module, module.exports);
  const render = () => { state = 0; ref = 0; effect = 0; return module.exports.EquipmentView(); };
  return { render, calls, AssignmentForm, async load() { render(); effects.splice(0).forEach(callback => callback()); for (let i = 0; i < 10; i++) await Promise.resolve(); } };
}
test('equipment assignment receives the staff array from the existing API response envelope', async () => {
  const f = fixture({ staff: people }); await f.load();
  const tree = f.render(); const create = nodes(tree).find(n => n.type === 'button' && text(n) === 'New assignment');
  assert.equal(create.props.disabled, false); create.props.onClick();
  const form = nodes(f.render()).find(n => n.type === f.AssignmentForm);
  assert.deepEqual(form.props.staff, people);
  assert(f.calls.includes('/staff?propertyId=property-1&activeOnDate=2026-11-09'));
});
test('empty staff responses remain arrays and malformed responses show a retryable error', async () => {
  const empty = fixture({ staff: [] }); await empty.load();
  nodes(empty.render()).find(n => n.type === 'button' && text(n) === 'New assignment').props.onClick();
  assert.deepEqual(nodes(empty.render()).find(n => n.type === empty.AssignmentForm).props.staff, []);
  const bad = fixture({ staff: null }); await bad.load();
  const tree = bad.render(); assert(text(tree).includes('Unable to read the staff list'));
  assert.equal(nodes(tree).find(n => n.type === 'button' && text(n) === 'New assignment').props.disabled, true);
});
