import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/inputValidation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { isRoomNumber, isPositiveInt } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('room validation preserves numeric identifiers with leading zeros and rejects letters and numeric syntax', () => {
  for (const room of ['0012', '0', ' 101 ', '1'.repeat(32)]) assert.equal(isRoomNumber(room), true);
  for (const room of ['', ' ', 'A101', '12 3', '12.3', '-1', '+1', '1e2', '١٢', '1'.repeat(33)]) assert.equal(isRoomNumber(room), false);
});
test('check numbers must fit the database integer contract without truncation', () => {
  for (const value of [1, 1001, 2147483647]) assert.equal(isPositiveInt(value), true);
  for (const value of [0, -1, 1.5, 2147483648, NaN, Infinity, '1001', null]) assert.equal(isPositiveInt(value), false);
});
