import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('import.meta.env.VITE_DEPLOYMENT_MODE', JSON.stringify('live'));
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => name in stubs ? stubs[name] : require(name), module, module.exports);
  return module.exports;
}
const personalRates = load('../src/utils/personalRates.ts');
const photoCredits = load('../src/utils/photoCredits.ts');
const automaticPhotos = load('../src/utils/automaticPhotos.ts', { './personalRates': personalRates, './photoCredits': photoCredits });
const checkout = load('../src/utils/checkoutDiscount.ts');
const instructorCredits = load('../src/utils/instructorCredits.ts');
const editing = load('../src/utils/billEditing.ts', { './instructorCredits': instructorCredits, './photoCredits': photoCredits });
const dates = load('../src/utils/dates.ts');
const inputs = load('../src/utils/inputValidation.ts');
function descendants(node, predicate) {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(child => descendants(child, predicate));
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...descendants(node.props.children, predicate)];
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : '';
function fixture() {
  const draft = { version: 1, checkNumber: 1001, checkEdited: true, businessDate: '2026-11-04', roomNumber: '0012', guestName: 'Test Guest', nationality: 'Other', departureDate: '', tipAmount: 0, tipStaffIds: [], notes: '', billLines: [{ clientLineId: 'root', itemId: 'dive', itemName: 'Dive', categoryName: 'Dives', quantity: 3, unitPrice: 100, discountPercent: 0, lineTotal: 300 }] };
  let cursor = 0;
  const states = [];
  const hooks = { ...React, useMemo: fn => fn(), useEffect() {}, useRef: value => ({ current: value }), useState: initial => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  } };
  const { NewBillView } = load('../src/components/NewBillView.tsx', {
    react: hooks,
    '../utils/instructorCredits': instructorCredits,
    '../utils/photoCredits': photoCredits,
    './InstructorPicker': { InstructorPicker: () => null },
    '../utils/billEditing': editing,
    '../utils/inputValidation': inputs,
    '../utils/checkoutDiscount': checkout,
    '../utils/nationalities': { nationalityCountries: [] },
    '../utils/automaticPhotos': automaticPhotos,
    '../utils/pmsGuests': {},
    '../hooks/useMonthLock': { useMonthLock: () => ({ locked: false, error: '', retry() {} }) },
    '../utils/format': { formatMoney: amount => '$' + amount.toFixed(2), formatUnitPrice: amount => '$' + amount.toFixed(3) },
    '../context/AuthContext': { useAuth: () => ({ user: { id: 'manager', role: 'PROPERTY_MANAGER' } }) },
    '../context/NavigationContext': { useUnsavedChanges: () => () => {} },
    '../utils/billDraft': { billDraftKey: () => 'fixture', loadBillDraft: () => draft },
    './Modal': { Modal: ({ children }) => React.createElement('div', null, children) },
    '../utils/dates': dates,
    '../context/PropertyContext': { useProperty: () => ({ activeProperty: { id: 'own', serviceChargeRate: 10, taxRate: 16 } }) },
    '../services/api': { apiFetch() { throw Error('No API during render'); } },
  });
  const render = () => { cursor = 0; return NewBillView({ onBillSaved() {}, onSetup() {} }); };
  const button = (tree, name) => descendants(tree, node => node.type === 'button' && text(node) === name)[0];
  const input = (tree, label) => descendants(descendants(tree, node => node.type === 'label' && text(node) === label)[0], node => node.type === 'input')[0];
  return { render, states, button, input };
}
test('the actual selected-unit discount controls split the chosen quantity and leave remaining units at full price', () => {
  const f = fixture();
  f.button(f.render(), 'Discount only some units').props.onClick();
  f.input(f.render(), 'Units to discount').props.onChange({ target: { value: '1' } });
  f.input(f.render(), 'Discount (%)').props.onChange({ target: { value: '20' } });
  f.button(f.render(), 'Apply to selected units').props.onClick();
  const lines = f.states.find(value => Array.isArray(value) && value.length === 2 && value[0]?.itemId === 'dive');
  assert.deepEqual(lines.map(line => [line.quantity, line.discountPercent, line.lineTotal]), [[2, 0, 200], [1, 20, 80]]);
  assert.doesNotMatch(renderToStaticMarkup(f.render()), /Units to discount/);
});
test('invalid quantities and an unapplied selected-unit discount cannot silently alter or pass bill review', () => {
  const f = fixture();
  f.button(f.render(), 'Discount only some units').props.onClick();
  f.input(f.render(), 'Units to discount').props.onChange({ target: { value: '4' } });
  f.button(f.render(), 'Apply to selected units').props.onClick();
  assert.match(renderToStaticMarkup(f.render()), /Choose a whole quantity on this line/);
  f.button(f.render(), 'Review bill').props.onClick();
  assert.match(renderToStaticMarkup(f.render()), /Apply or cancel the selected-unit discount/);
});
