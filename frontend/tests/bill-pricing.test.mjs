import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/utils/billPricing.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { adjustBillLine } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('price overrides retain staff assignments and explicit discounts without mutating source lines', () => {
  const line = { quantity: 2, unitPrice: 100, discountPercent: 10, lineTotal: 180, instructorStaffIds: ['a', 'b'] };
  const updated = adjustBillLine(line, 'lineTotal', 90);
  assert.equal(updated.unitPrice, 50);
  assert.equal(updated.discountPercent, 10);
  assert.equal(updated.lineTotal, 90);
  assert.deepEqual(updated.instructorStaffIds, ['a', 'b']);
  assert.equal(line.unitPrice, 100);
  assert.equal(adjustBillLine(line, 'unitPrice', 0).lineTotal, 0);
  assert.equal(adjustBillLine({ ...line, discountPercent: 100 }, 'lineTotal', 100).lineTotal, 100);
});
test('invalid prices reject without changes, and generated Photo lines retain property prices', () => {
  const line = { quantity: 2, unitPrice: 41.975, discountPercent: 0, lineTotal: 83.95, autoPhotoFor: 'activity' };
  for (const value of [-1, NaN, Infinity, 1e308]) assert.throws(() => adjustBillLine({ ...line, autoPhotoFor: null }, 'unitPrice', value));
  assert.throws(() => adjustBillLine(line, 'unitPrice', 20), /set by the property/);
  assert.throws(() => adjustBillLine(line, 'lineTotal', 20), /set by the property/);
  assert.throws(() => adjustBillLine(line, 'discountPercent', 101), /0 and 100/);
  assert.equal(adjustBillLine(line, 'discountPercent', 100).lineTotal, 0);
});
