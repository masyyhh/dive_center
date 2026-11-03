import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/utils/checkoutDiscount.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {applyCheckoutDiscount}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('checkout preview allocates a percentage after line discounts and keeps source lines unchanged',()=>{
  const lines=[{quantity:2,unitPrice:100,discountPercent:10},{quantity:1,unitPrice:50,discountPercent:0}];
  const preview=applyCheckoutDiscount(lines,20);
  assert.equal(preview.subtotal,230); assert.equal(preview.amount,46);
  assert.deepEqual(preview.lines.map(line=>line.discountPercent),[28,20]);
  assert.deepEqual(preview.lines.map(line=>line.lineTotal),[144,40]);
  assert.deepEqual(lines.map(line=>line.discountPercent),[10,0]);
});
test('zero, complete and invalid percentage discounts are handled consistently',()=>{
  const lines=[{quantity:1,unitPrice:100,discountPercent:12.34}];
  assert.equal(applyCheckoutDiscount(lines).lines[0].discountPercent,12.34);
  assert.equal(applyCheckoutDiscount(lines,100).lines[0].lineTotal,0);
  assert.equal(applyCheckoutDiscount([],100).amount,0);
  for(const value of [-1,100.01,NaN,Infinity]) assert.throws(()=>applyCheckoutDiscount(lines,value),/0 and 100/);
});
test('browser and API use the same checkout allocation calculation',async()=>{
  const server=await readFile(new URL('../../backend/src/utils/checkoutDiscount.ts',import.meta.url),'utf8');
  assert.equal(source,server);
});
