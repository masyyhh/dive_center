import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => name in stubs ? stubs[name] : require(name), module, module.exports);
  return module.exports;
}
const dates = load('../src/utils/dates.ts');
const navigation = load('../src/utils/dashboardNavigation.ts', { './dates': dates });
const { investigationPeriod, investigationSection } = navigation;

test('investigation links preserve historical ranges and the discounted-bills filter', () => {
  for (const kind of ['revenue', 'discounts', 'commissions']) {
    const section = investigationSection(kind, '2026-08-01', '2026-08-31');
    assert.deepEqual(investigationPeriod(section), { startDate: '2026-08-01', endDate: '2026-08-31', discountedOnly: kind === 'discounts' });
    assert.equal(section.split('?')[0], kind === 'commissions' ? 'commissions' : 'range');
  }
});

test('bad deep-linked ranges cannot override report defaults', () => {
  for (const section of ['', 'commissions', 'range?startDate=2026-02-30&endDate=2026-03-01', 'range?startDate=2026-09-01&endDate=2026-08-31']) assert.equal(investigationPeriod(section), null);
});
const row = { propertyId: 'a', name: 'Centre A', code: 'A', isActive: true, currency: 'USD', currencySymbol: '$', revenue: 150, discounts: 50, commissions: 31.5, billCount: 1, missingAttendance: 2, missingDays: 2, firstMissingDate: '2026-08-03' };
const data = { period: { startDate: '2026-08-01', endDate: '2026-08-31', attendanceBefore: '2026-11-01' }, properties: [row], totals: { propertyCount: 1, missingAttendance: 2, currencies: [{ currency: 'USD', revenue: 150, discounts: 50, commissions: 31.5, billCount: 1 }] } };
function dashboard(report = data, busy = false) {
  let hook = 0;
  const calls = [];
  const property = { id: 'a', name: 'Centre A' };
  const react = { ...React, useState: initial => { const index = hook++; return [index === 2 ? report : index === 3 ? busy : initial, () => {}]; }, useEffect() {}, useRef: value => ({ current: value }) };
  const { GlobalDashboard } = load('../src/components/GlobalDashboard.tsx', {
    react,
    '../context/PropertyContext': { useProperty: () => ({ properties: [property], setActiveProperty: value => calls.push(['property', value.id]) }) },
    '../context/NavigationContext': { useNavigation: () => ({ requestNavigation: action => action() }) },
    '../services/api': { apiFetch() { throw Error('Effects must not run during render'); } },
    '../utils/dates': dates,
    '../utils/dashboardNavigation': navigation,
    '../utils/format': { formatMoney: (amount, symbol) => `${symbol}${amount.toFixed(2)}` },
  });
  const tree = GlobalDashboard({ onNavigate: (...args) => calls.push(['navigate', ...args]) });
  return { tree, calls, html: renderToStaticMarkup(tree) };
}
function find(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(child => find(child, label)).find(Boolean);
  if (node.props?.['aria-label'] === label) return node;
  return find(node.props?.children, label);
}

test('global figures include clear revenue, payroll and attendance definitions and currency labels', () => {
  const { html } = dashboard();
  assert.match(html, /USD totals/);
  assert.match(html, /USD 150.00/);
  assert.match(html, /USD 50.00/);
  assert.match(html, /USD 31.50/);
  assert.match(html, /Today and future dates are excluded/);
  assert.match(html, /including tips/);
  assert.match(html, /without conversion/);
});

test('each investigation changes property and opens the exact selected report period or first missing date', () => {
  for (const kind of ['revenue', 'discounts', 'commissions']) {
    const { tree, calls } = dashboard();
    find(tree, `Investigate ${kind} for Centre A`).props.onClick();
    assert.deepEqual(calls, [['property', 'a'], ['navigate', kind === 'commissions' ? 'reporting' : 'bills', investigationSection(kind, '2026-08-01', '2026-08-31')]]);
  }
  const { tree, calls } = dashboard();
  find(tree, 'Investigate missing attendance for Centre A').props.onClick();
  assert.deepEqual(calls, [['property', 'a'], ['navigate', 'presence', '2026-08-03']]);
});

test('an unavailable report shows loading rather than invented financial zeros', () => {
  const { html } = dashboard(null, true);
  assert.match(html, /Loading property comparisons/);
  assert.doesNotMatch(html, /USD 0.00|Compare properties/);
});

test('discount investigation opens active bills in the exact period and shows only discounted rows with reconcilable amounts', () => {
  const fixtureBills = [
    { id: 'discounted', checkNumber: 101, businessDate: '2026-08-04', guestName: 'Discount guest', roomNumber: '101', grossAmount: 200, discountAmount: 50, netAmount: 180, status: 'ACTIVE' },
    { id: 'regular', checkNumber: 102, businessDate: '2026-08-04', guestName: 'Regular guest', roomNumber: '102', grossAmount: 100, discountAmount: 0, netAmount: 110, status: 'ACTIVE' },
  ];
  let hook = 0;
  const { BillsView } = load('../src/components/BillsView.tsx', {
    react: { ...React, useState: initial => { const index = hook++; return [index === 5 ? fixtureBills : index === 6 ? false : initial, () => {}]; }, useEffect() {}, useRef: value => ({ current: value }) },
    './Modal': { Modal: () => null },
    '../context/PropertyContext': { useProperty: () => ({ activeProperty: { id: 'a', currencySymbol: '$' } }) },
    '../services/api': { apiFetch() { throw Error('Effects must not run during render'); } },
    '../utils/dates': dates,
    '../utils/dashboardNavigation': navigation,
    '../utils/format': { formatMoney: (amount, symbol) => `${symbol}${amount.toFixed(2)}` },
  });
  const tree = BillsView({ section: investigationSection('discounts', '2026-08-01', '2026-08-31'), savedCheck: null, onDismissSaved() {} });
  const html = renderToStaticMarkup(tree);
  assert.equal(find(tree, 'Bills from date').props.value, '2026-08-01');
  assert.equal(find(tree, 'Bills to date').props.value, '2026-08-31');
  assert.match(html, /aria-pressed="true"[^>]*>Active/);
  assert.match(html, /Discount guest/);
  assert.doesNotMatch(html, /Regular guest/);
  assert.match(html, /revenue \$150.00 · discounts \$50.00/);
  assert.match(html, />Revenue<\/th>/);
  assert.match(html, />Discounts<\/th>/);
});
