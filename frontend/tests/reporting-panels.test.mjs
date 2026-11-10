import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const components = fileURLToPath(new URL('../src/components/', import.meta.url));
function load(file, overrides = {}) {
  const source = readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => {
    if (name in overrides) return overrides[name];
    if (!name.startsWith('.')) return require(name);
    const base = path.resolve(path.dirname(file), name);
    const resolved = ['.ts', '.tsx'].map(ext => base + ext).find(existsSync);
    return load(resolved, overrides);
  }, module, module.exports);
  return module.exports;
}
const { CommissionPanel } = load(path.join(components, 'reporting/CommissionPanel.tsx'));
const { ExportPanel } = load(path.join(components, 'reporting/ExportPanel.tsx'));
const { PerformancePanel } = load(path.join(components, 'reporting/PerformancePanel.tsx'));
const report = {
  period: { isLocked: false },
  headline: { turnover: 100, serviceCharge: 10, tax: 17.6, billCount: 1, averageBill: 100, totalCommission: 25 },
  charts: { categoryRevenue: [], nationalityRevenue: [], topItems: [], weekdayRevenue: [] },
  staffCommissions: [{ staffId: 'staff-1', staffName: 'Instructor One', roleTitle: 'Instructor', courseCommission: 2, diveCommission: 3, overrideCommission: 4, tipsCommission: 5, personalCommission: 11, totalCommission: 25 }],
  personalDetails: [],
};
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
const button = (tree, name) => find(tree, node => node.type === 'button' && text(node) === name);
test('commission exports keep staff columns and amounts; detail action receives the correct staff ID', () => {
  const calls = [];
  const tree = CommissionPanel({ report, currencySymbol: '$', loading: false, recomputing: false, downloadChartCsv: (...args) => calls.push(args), setBreakdownStaffId: id => calls.push(id) });
  button(tree, 'Export Table CSV').props.onClick();
  assert.deepEqual(calls[0], ['Staff_Commission', ['Staff Name', 'Role', 'Course Pool', 'Dive Pool', 'Override', 'Tips', 'Personal', 'Total'], [['Instructor One', 'Instructor', 2, 3, 4, 5, 11, 25]]]);
  button(tree, 'Why this amount?').props.onClick();
  assert.equal(calls[1], 'staff-1');
  assert.match(renderToStaticMarkup(tree), /\$25.00/);
});
test('recompute remains disabled when loading, recomputing, missing a report or in locked payroll', () => {
  for (const state of [{ loading: true, report }, { recomputing: true, report }, { report: null }, { report: { ...report, period: { isLocked: true } } }]) {
    const tree = CommissionPanel({ report, loading: false, recomputing: false, currencySymbol: '$', ...state });
    assert.equal(button(tree, 'Recompute Commission').props.disabled, true);
  }
});
test('export dates, downloads and payroll actions remain separate; staff cannot see manager lock controls', () => {
  const calls = [];
  const props = { exportWeekDate: '2026-11-04', setExportWeekDate: date => calls.push(['week', date]), handleDownloadWeekly: () => calls.push('weekly'), exportDate: '2026-11-04', exportMonth: '2026-10', payrollLocked: false, payrollLoading: false, payrollError: '', lockLoading: false, canManageLocks: true, setExportDate: date => calls.push(['date', date]), setExportMonth: month => calls.push(['month', month]), handleDownloadDaily: () => calls.push('daily'), handleDownloadMonthly: () => calls.push('monthly'), onConfirmLock: () => calls.push('confirm') };
  const tree = ExportPanel(props);
  find(tree, node => node.props?.['aria-label'] === 'Download daily PDF').props.onClick();
  find(tree, node => node.props?.['aria-label'] === 'Download monthly PDF').props.onClick();
  find(tree, node => node.props?.['aria-label'] === 'Download weekly PDF').props.onClick();
  find(tree, node => node.props?.['aria-label'] === 'Weekly report date').props.onChange({ target: { value: '2026-11-09' } });
  button(tree, 'Lock month').props.onClick();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Daily Report \(.pdf\)/);
  assert.match(html, /2 Nov 2026 – 8 Nov 2026/);
  assert.match(html, /Weekly Report/);
  assert.match(html, /Monthly Report \(.pdf\)/);
  assert.doesNotMatch(html, /xlsx|Workbook/);
  find(tree, node => node.props?.['aria-label'] === 'Daily report date').props.onChange({ target: { value: '2026-11-03' } });
  assert.deepEqual(calls, ['daily', 'monthly', 'weekly', ['week', '2026-11-09'], 'confirm', ['date', '2026-11-03']]);
  assert.equal(button(ExportPanel({ ...props, canManageLocks: false }), 'Lock month'), undefined);
  assert.equal(find(ExportPanel({ ...props, exportWeekDate: '' }), node => node.props?.['aria-label'] === 'Download weekly PDF').props.disabled, true);
  assert.equal(find(ExportPanel({ ...props, exportDate: '' }), node => node.props?.['aria-label'] === 'Download daily PDF').props.disabled, true);
  assert.equal(find(ExportPanel({ ...props, exportMonth: '' }), node => node.props?.['aria-label'] === 'Download monthly PDF').props.disabled, true);
  assert.equal(button(ExportPanel({ ...props, payrollLocked: null }), 'Lock month').props.disabled, true);
});
test('performance values and empty chart feedback remain available without data', () => {
  const html = renderToStaticMarkup(PerformancePanel({ report, currencySymbol: '$' }));
  assert.match(html, /\$100.00/);
  assert.match(html, /No saved bills in this period/);
  assert.doesNotThrow(() => renderToStaticMarkup(PerformancePanel({ report: null, currencySymbol: '$' })));
});


test('weekly date ranges are calendar-based across Sundays, years and leap days', () => {
 const { businessWeek } = load(path.join(components, '../utils/dates.ts'));
 for (const date of ['2026-11-02', '2026-11-08']) assert.deepEqual(businessWeek(date), { start: '2026-11-02', end: '2026-11-08' });
 assert.deepEqual(businessWeek('2028-01-01'), { start: '2027-12-27', end: '2028-01-02' });
 assert.deepEqual(businessWeek('2028-02-29'), { start: '2028-02-28', end: '2028-03-05' });
 assert.equal(businessWeek('2026-02-29'), null);
 assert.equal(businessWeek(''), null);
});


test('month boundaries preserve early years and leap days in payroll requests',()=>{
 const {monthRange}=load(path.join(components,'../utils/dates.ts'));
 assert.deepEqual(monthRange('0000-02'),{start:'0000-02-01',end:'0000-02-29'});
 assert.deepEqual(monthRange('0099-12'),{start:'0099-12-01',end:'0099-12-31'});
 assert.deepEqual(monthRange('9999-12'),{start:'9999-12-01',end:'9999-12-31'});
});

test('This Month uses the Maldives month during the UTC month-boundary window',()=>{
 const RealDate=globalThis.Date;
 class BoundaryDate extends RealDate { constructor(...args){super(...(args.length?args:['2026-10-31T21:00:00Z']));} }
 const calls=[];
 try {
  globalThis.Date=BoundaryDate;
  const {BillsFilters}=load(path.join(components,'bills/BillsFilters.tsx'),{'../../utils/dates':{businessToday:()=> '2026-11-01',displayDate:value=>value}});
  const tree=BillsFilters({model:{splitView:false,visibleBills:[],startDate:'2026-10-01',endDate:'2026-10-31',statusFilter:'ALL',search:'',setStartDate:value=>calls.push(['start',value]),setEndDate:value=>calls.push(['end',value])}});
  button(tree,'This Month').props.onClick();
  assert.deepEqual(calls,[['start','2026-11-01'],['end','2026-11-01']]);
 } finally {globalThis.Date=RealDate;}
});
