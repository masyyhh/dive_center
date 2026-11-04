import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/billEditing.ts', import.meta.url), 'utf8');
const helperSource = await readFile(new URL('../src/utils/instructorCredits.ts', import.meta.url), 'utf8');
const helper = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const helperURL = `data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`;
const photoSource = await readFile(new URL('../src/utils/photoCredits.ts', import.meta.url), 'utf8');
const photoHelper = ts.transpileModule(photoSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const photoURL = `data:text/javascript;base64,${Buffer.from(photoHelper).toString('base64')}`;
const compiled = ts.transpileModule(source.replace("'./instructorCredits'", JSON.stringify(helperURL)).replace("'./photoCredits'", JSON.stringify(photoURL)), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { billToEditDraft } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('posted bills restore into an edit draft with source identities and no repeated checkout discount', () => {
  const bill = { id: 'posted', updatedAt: '2026-11-04T08:00:00.000Z', checkNumber: 1001, businessDate: '2026-11-04', roomNumber: '0012', guestName: 'Guest', nationality: 'Other', tipAmount: 5, tipStaffIdsJson: '["staff"]', notes: 'Saved',
    items: [{ id: 'root', quantity: 2, unitPrice: 100, discountPercent: 28 }, { id: 'photo', autoPhotoForLineId: 'root', quantity: 2, unitPrice: 41.975, discountPercent: 20 }] };
  const before = structuredClone(bill);
  const draft = billToEditDraft(bill);
  assert.deepEqual(bill, before);
  assert.equal(draft.expectedUpdatedAt, bill.updatedAt);
  assert.equal(draft.checkoutDiscountPercent, '');
  assert.equal(draft.billLines[0].discountPercent, 28);
  assert.equal(draft.billLines[1].autoPhotoFor, 'root');
  assert.equal(draft.billLines[0].sourceLineId, 'root');
  assert.equal(draft.roomNumber, '0012'); assert.deepEqual(draft.tipStaffIds, ['staff']);
});

test('editing retains every saved instructor and restores legacy single instructors', () => {
  const bill = { updatedAt: '2026-11-04T08:00:00.000Z', tipStaffIdsJson: '[]', items: [
    { id: 'shared', instructorStaffId: 'one', instructorCredits: [{ staffId: 'one' }, { staffId: 'two' }] },
    { id: 'legacy', instructorStaffId: 'old' },
    { id: 'none', instructorStaffId: null },
  ] };
  assert.deepEqual(billToEditDraft(bill).billLines.map(line => line.instructorStaffIds), [['one', 'two'], ['old'], []]);
});

test('editing restores every saved Photo recipient and the legacy single photographer', () => {
  const bill = { updatedAt: '2026-11-04T08:00:00.000Z', items: [{ id: 'photo', photoStaffId: 'one', photoCredits: [{ staffId: 'one' }, { staffId: 'two' }] }, { id: 'legacy', photoStaffId: 'old' }] };
  assert.deepEqual(billToEditDraft(bill).billLines.map(line => line.photoStaffIds), [['one', 'two'], ['old']]);
});
