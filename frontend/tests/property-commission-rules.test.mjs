import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/components/CommissionRulesView.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } });
const module = { exports: {} };
new Function('require', 'module', 'exports', outputText)(name => {
  if (name === './PersonalCommissionEditor') return { PersonalCommissionSummary: ({ item }) => React.createElement('span', null, item.personalRatesJson) };
  if (name === '../utils/format') return { formatMoney: (value, symbol) => `${symbol}${value.toFixed(2)}` };
  return require(name);
}, module, module.exports);
const { CommissionRulesView } = module.exports;
const item = { id: 'dive', propertyId: 'a', code: 'DIV-1', name: 'Boat dive', category: { name: 'Dives' }, isActive: true, poolType: 'DIVE_POOL', poolContribution: 12, personalRatesJson: '{"guide":7}', includesComplimentaryMedia: false };
const render = (props = {}) => renderToStaticMarkup(React.createElement(CommissionRulesView, { property: { id: 'a', name: 'Centre A', currencySymbol: '€' }, items: [item], loading: false, busy: false, onEdit() {}, onCopy() {}, onStaff() {}, ...props }));

test('property rules show percentage pools, fixed certifications and automatic Photo terms', () => {
  const html = render({ items: [item, { ...item, id: 'cert', name: 'Certification fee', poolType: 'CERTIFICATION_POOL', poolContribution: 20, includesComplimentaryMedia: true }] });
  assert.match(html, /Commission rules · Centre A/);
  assert.match(html, /Dive pool · 12%/);
  assert.match(html, /Certifications · €20.00 \/ unit/);
  assert.match(html, /Automatic Photo: \$41\.975 charge · \$4.50 employee payment per unit/);
  assert.match(html, /Edit commission rules for Boat dive/);
  assert.match(html, /New activity with these rules/);
});

test('switching properties cannot display the previous property’s rules or deleted activities', () => {
  const html = render({ items: [{ ...item, propertyId: 'b', name: 'Other property' }, { ...item, isActive: false, name: 'Deleted service' }] });
  assert.doesNotMatch(html, /Other property|Deleted service/);
  assert.match(html, /Add activities in Catalogue/);
  assert.match(render({ property: null }), /Choose a property to customize/);
});

test('loading hides actions and busy operations disable editing', () => {
  const loading = render({ loading: true });
  assert.match(loading, /Loading commission rules/);
  assert.doesNotMatch(loading, /Edit rules/);
  assert.match(render({ busy: true }), /disabled=""[^>]*aria-label="Edit commission rules for Boat dive"/);
});
