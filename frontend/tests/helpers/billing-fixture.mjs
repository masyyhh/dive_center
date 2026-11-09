import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const testBase = new URL('../', import.meta.url);
const billingComponents = new Set();
function load(path, stubs = {}, origin) {
  const url = path instanceof URL ? path : new URL(path, testBase);
  origin ??= url.pathname === '/tmp/NewBillView-before.tsx' ? new URL('../src/components/NewBillView.tsx', testBase) : url;
  const source = readFileSync(url, 'utf8').replaceAll('import.meta.env.VITE_DEPLOYMENT_MODE', JSON.stringify('live'));
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'document', 'Node', 'window', js)(name => {
    if (name === 'react' && url.pathname.endsWith('/NewBillView.tsx') && stubs.__viewEffects) return { ...stubs.react, useEffect: callback => stubs.__viewEffects.push(callback) };
    if (name === 'react' && url.pathname.endsWith('/useBillController.ts') && stubs.__controllerEffects) return { ...stubs.react, useEffect: callback => stubs.__controllerEffects.push(callback) };
    if (name in stubs) return stubs[name];
    if (!name.startsWith('.')) return require(name);
    const base = new URL(name, url.pathname === '/tmp/NewBillView-before.tsx' ? origin : url);
    const override = Object.entries(stubs).find(([key]) => key.startsWith('.') && new URL(key, origin).href === base.href);
    if (override) return override[1];
    const target = ['.ts', '.tsx'].map(ext => new URL(base.href + ext)).find(existsSync);
    const result = load(target, stubs, origin);
    if (target.pathname.includes('/components/billing/')) for (const value of Object.values(result)) if (typeof value === 'function') billingComponents.add(value);
    return result;
  }, module, module.exports, stubs.__document ?? globalThis.document, stubs.__Node ?? globalThis.Node, stubs.__window ?? globalThis.window);
  return module.exports;
}
function expand(node) {
  if (Array.isArray(node)) return node.map((child,index)=>{const value=expand(child);return React.isValidElement(value)?React.cloneElement(value,{key:value.key??index}):value;});
  if (!React.isValidElement(node)) return node;
  if (billingComponents.has(node.type)) return expand(node.type(node.props));
  return node.props.children === undefined ? node : React.cloneElement(node, {}, expand(node.props.children));
}

const personalRates = load('../src/utils/personalRates.ts');
const photoCredits = load('../src/utils/photoCredits.ts');
const automaticPhotos = load('../src/utils/automaticPhotos.ts', { './personalRates': personalRates, './photoCredits': photoCredits });
const checkout = load('../src/utils/checkoutDiscount.ts');
const instructorCredits = load('../src/utils/instructorCredits.ts');
const editing = load('../src/utils/billEditing.ts', { './instructorCredits': instructorCredits, './photoCredits': photoCredits });
const dates = load('../src/utils/dates.ts');
const inputs = load('../src/utils/inputValidation.ts');
export function descendants(node, predicate) {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(child => descendants(child, predicate));
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...descendants(node.props.children, predicate)];
}
export const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : '';
export const catalogue = model => load('../src/components/billing/ActivityCatalogue.tsx').ActivityCatalogue({ model });
export function fixture(propertyName = 'Iru Fushi', options = {}) {
  const draft = { version: 1, checkNumber: 1001, checkEdited: true, businessDate: '2026-11-04', roomNumber: '0012', guestName: 'Test Guest', nationality: 'Other', departureDate: '', tipAmount: 0, tipStaffIds: [], notes: '', billLines: [{ clientLineId: 'root', itemId: 'dive', itemName: 'Dive', categoryName: 'Dives', quantity: 3, unitPrice: 100, discountPercent: 0, lineTotal: 300 }], ...options.draft };
  let cursor = 0;
  const states = [];
  const effects = [];
  const controllerEffects = [];
  const refs = [];
  let refCursor = 0;
  const hooks = { ...React, useMemo: fn => fn(), useEffect() {}, useRef: value => refs[refCursor++] ??= { current: value }, useState: initial => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  } };
  const { NewBillView } = load(options.sourceFile || '../src/components/NewBillView.tsx', {
    __viewEffects: effects,
    __controllerEffects: options.runControllerEffects ? controllerEffects : undefined,
    __window: { addEventListener() {}, removeEventListener() {} },
    __document: options.document,
    __Node: options.Node,
    react: hooks,
    '../utils/propertyPresentation': load('../src/utils/propertyPresentation.ts'),
    '../utils/instructorCredits': instructorCredits,
    '../utils/photoCredits': photoCredits,
    './InstructorPicker': { InstructorPicker: () => null },
    '../utils/billEditing': editing,
    '../utils/inputValidation': inputs,
    '../utils/checkoutDiscount': checkout,
    '../utils/nationalities': { nationalityCountries: [] },
    '../utils/automaticPhotos': automaticPhotos,
    '../utils/pmsGuests': {},
    '../hooks/useMonthLock': { useMonthLock: () => ({ locked: options.locked ?? false, error: '', retry() {} }) },
    '../utils/format': { formatMoney: amount => '$' + amount.toFixed(2), formatUnitPrice: amount => '$' + amount.toFixed(3) },
    '../context/AuthContext': { useAuth: () => ({ user: { id: 'manager', role: 'PROPERTY_MANAGER' } }) },
    '../context/NavigationContext': { useUnsavedChanges: () => () => {} },
    '../utils/billDraft': { billDraftKey: () => 'fixture', loadBillDraft: () => draft },
    './Modal': { Modal: ({ children }) => React.createElement('div', null, children) },
    '../utils/dates': dates,
    '../context/PropertyContext': { useProperty: () => ({ activeProperty: { id: 'own', name: propertyName, serviceChargeRate: 10, taxRate: 16 } }) },
    '../services/api': { apiFetch: options.apiFetch ?? (() => { throw Error('No API during render'); }) },
  });
  const render = () => { cursor = 0; refCursor = 0; effects.length = 0; controllerEffects.length = 0; return expand(NewBillView({ onBillSaved: options.onBillSaved ?? (() => {}), onSetup() {}, editingBill: options.editingBill })); };
  const button = (tree, name) => descendants(tree, node => node.type === 'button' && text(node) === name)[0];
  const input = (tree, label) => descendants(descendants(tree, node => node.type === 'label' && text(node) === label)[0], node => node.type === 'input')[0];
  return { render, states, effects, controllerEffects, button, input };
}
