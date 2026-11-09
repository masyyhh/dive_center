import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/commissionCalculator.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { calculateCommissionPreview } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const input = { price: 200, quantity: 2, discount: 25, poolType: 'NONE', poolRate: 0, selections: [], combinedMedia: false, storeAttendantPool: true };
test('Retail employee payment previews share five percent of discounted sales', () => {
  const result = calculateCommissionPreview(input);
  assert.equal(result.serviceTotal, 300);
  assert.equal(result.employeeTotal, 15);
  assert.equal(result.payments[0].role, 'storeAttendantPool');
  assert.equal(calculateCommissionPreview({ ...input, storeAttendantPool: false }).employeeTotal, 0);
  assert.equal(calculateCommissionPreview({ ...input, discount: 100 }).employeeTotal, 0);
  assert.equal(calculateCommissionPreview({ ...input, price: .1, discount: 0 }).employeeTotal, .01);
});
test('Retail pools coexist with fixed employee payments without replacing them', () => {
  const result = calculateCommissionPreview({ ...input, selections: [{ role: 'seller', enabled: true, amount: '10' }] });
  assert.equal(result.employeeTotal, 30);
  assert.equal(result.payments.length, 2);
});
