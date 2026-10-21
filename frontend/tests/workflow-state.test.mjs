import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Load the actual pure TypeScript helpers without adding a browser or test framework.
async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { billDraftKey, isBillDraft, loadBillDraft } = await loadModule('../src/utils/billDraft.ts');
const { attendanceSnapshot, attendanceDayState } = await loadModule('../src/utils/attendance.ts');
const draft = { version: 1, checkNumber: 1005, businessDate: '2026-10-20', roomNumber: '304', guestName: 'Test guest', departureDate: '', nationality: 'Other', tipAmount: 0, tipStaffIds: [], billLines: [{ itemName: 'Boat dive', categoryName: 'Dives', quantity: 2, unitPrice: 85, discountPercent: 10, lineTotal: 153 }], notes: '', checkEdited: false };

test('drafts restore only for their account and property', () => {
  const store = new Map([[billDraftKey('user-a', 'male'), JSON.stringify(draft)]]);
  globalThis.sessionStorage = { getItem: key => store.get(key) ?? null };
  assert.deepEqual(loadBillDraft(billDraftKey('user-a', 'male')), draft);
  assert.equal(loadBillDraft(billDraftKey('user-b', 'male')), null);
  assert.equal(loadBillDraft(billDraftKey('user-a', 'ari')), null);
});
test('corrupt and incompatible drafts never break the bill screen', () => {
  for (const value of ['{broken', JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, billLines: [null] })]) {
    globalThis.sessionStorage = { getItem: () => value };
    assert.equal(loadBillDraft('test'), null);
  }
  globalThis.sessionStorage = { getItem: () => { throw new Error('Storage blocked'); } };
  assert.equal(loadBillDraft('test'), null);
});
test('invalid draft amounts and quantities are rejected', () => {
  assert.equal(isBillDraft(draft), true);
  for (const patch of [{ quantity: -1 }, { quantity: 1.5 }, { unitPrice: Infinity }, { discountPercent: 101 }]) {
    assert.equal(isBillDraft({ ...draft, billLines: [{ ...draft.billLines[0], ...patch }] }), false);
  }
  assert.equal(isBillDraft({ ...draft, tipAmount: -1 }), false);
});
test('attendance distinguishes unsaved status and note edits from roster order', () => {
  const roster = [{ staffMemberId: 'a', status: 'PRESENT', note: '' }, { staffMemberId: 'b', status: 'OFF' }];
  assert.equal(attendanceSnapshot(roster), attendanceSnapshot([...roster].reverse()));
  assert.notEqual(attendanceSnapshot(roster), attendanceSnapshot([{ ...roster[0], status: 'SICK' }, roster[1]]));
  assert.notEqual(attendanceSnapshot(roster), attendanceSnapshot([{ ...roster[0], note: 'Late arrival' }, roster[1]]));
});
test('no-staff dates are never represented as partial or complete', () => {
  assert.equal(attendanceDayState({ markedCount: 0, expectedCount: 0 }, '2026-10-19', '2026-10-20').label, 'No staff');
});
test('today and future dates are unrecorded; empty past dates are missing', () => {
  const info = { markedCount: 0, expectedCount: 3 };
  assert.equal(attendanceDayState(info, '2026-10-19', '2026-10-20').label, 'Missing');
  assert.equal(attendanceDayState(info, '2026-10-20', '2026-10-20').label, 'Not recorded');
  assert.equal(attendanceDayState(info, '2026-10-21', '2026-10-20').label, 'Not recorded');
  assert.equal(attendanceDayState({ markedCount: 1, expectedCount: 3 }, '2026-10-20', '2026-10-20').label, 'Partial');
  assert.equal(attendanceDayState({ markedCount: 3, expectedCount: 3 }, '2026-10-20', '2026-10-20').label, 'Complete');
  assert.equal(attendanceDayState(undefined, '2026-10-20', '2026-10-20').label, 'Unavailable');
});
const { monthRange } = await loadModule('../src/utils/dates.ts');
test('payroll lookups use real month ends, including leap years', () => {
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
  assert.equal(monthRange('2026-13'), null);
});
const { isBusinessDate, displayDate } = await loadModule('../src/utils/dates.ts');
test('invalid deep-linked dates do not crash attendance or date labels', () => {
  assert.equal(isBusinessDate('2026-02-30'), false);
  assert.equal(isBusinessDate('2026-99-01'), false);
  assert.equal(isBusinessDate('2028-02-29'), true);
  assert.equal(displayDate('not-a-date'), '—');
  assert.equal(displayDate('2026-10-20'), '20 Oct 2026');
});
test('an unfinished date edit does not discard the rest of a bill draft', () => {
  assert.equal(isBillDraft({ ...draft, businessDate: '' }), true);
});

const { csvCell, serializeCsv } = await loadModule('../src/utils/csv.ts');
test('CSV exports neutralize spreadsheet formulas including leading whitespace and controls', () => {
  for (const value of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '\u0000=1+1']) {
    assert.equal(csvCell(value).startsWith('"\''), true, JSON.stringify(value));
  }
  assert.equal(csvCell(-12.5), '"-12.5"');
  assert.equal(serializeCsv([['Guest, "A"', 'Café'], [12, null]]), '"Guest, ""A""","Café"\r\n"12",""');
});

const { guestBillFields } = await loadModule('../src/utils/pmsGuests.ts');
test('PMS guest selection uses the selected sharer’s own dates and nationality and clears missing previous guest values', () => {
  const sharer = { fullName: 'Test Sharer', checkoutDate: '2026-10-24', nationality: 'To be Adviced' };
  assert.deepEqual(guestBillFields(sharer), { guestName: 'Test Sharer', departureDate: '2026-10-24', nationality: 'To be Adviced' });
  assert.deepEqual(guestBillFields({ fullName: 'Other Guest', checkoutDate: null, nationality: null }), { guestName: 'Other Guest', departureDate: '', nationality: '' });
});
