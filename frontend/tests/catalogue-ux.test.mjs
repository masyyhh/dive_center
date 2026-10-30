import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { calculateCommissionPreview } = await load('../src/utils/commissionCalculator.ts');
const { filterCatalogue, emptyCatalogueFilters } = await load('../src/utils/catalogueFilters.ts');
const fixture = { price: 200, quantity: 2, discount: 25, poolType: 'COURSE_POOL', poolRate: 10, selections: [{ role: 'seller', enabled: true, amount: '5' }, { role: 'photo', enabled: true, amount: '99' }, { role: 'video', enabled: true, amount: '99' }], combinedMedia: true };
test('calculator distinguishes discounted percentage pools from fixed combined employee payments', () => {
  const result = calculateCommissionPreview(fixture);
  assert.equal(result.gross, 400); assert.equal(result.discountAmount, 100); assert.equal(result.serviceTotal, 300);
  assert.equal(result.poolAmount, 30); assert.equal(result.photoCharge, 115); assert.equal(result.billSubtotal, 415);
  assert.deepEqual(result.payments, [{ role: 'seller', unitRate: 5, amount: 10 }, { role: 'media', unitRate: 4.5, amount: 9 }]);
  assert.equal(result.employeeTotal, 19);
});
test('complimentary example has zero course/dive pool but retains the fixed photo/video payment', () => {
  for (const poolType of ['COURSE_POOL', 'DIVE_POOL']) {
    const result = calculateCommissionPreview({ ...fixture, poolType, discount: 100 });
    assert.equal(result.photoCharge, 115); assert.equal(result.billSubtotal, 115); assert.equal(result.serviceTotal, 0); assert.equal(result.poolAmount, 0); assert.equal(result.payments.find(payment => payment.role === 'media').amount, 9);
  }
});
test('certifications stay fixed per unit and invalid preview inputs do not display misleading totals', () => {
  assert.equal(calculateCommissionPreview({ ...fixture, poolType: 'CERTIFICATION_POOL', poolRate: 25 }).poolAmount, 50);
  assert.equal(calculateCommissionPreview({ ...fixture, poolType: 'NONE' }).poolAmount, 0);
  for (const patch of [{ quantity: 0 }, { quantity: 1.5 }, { discount: -1 }, { discount: 101 }, { price: NaN }, { poolRate: 101 }, { selections: [{ role: 'seller', enabled: true, amount: '' }] }]) {
    assert.equal(calculateCommissionPreview({ ...fixture, ...patch }), null);
  }
});
const items = [
  { id: 'course', code: 'CRS-001', name: 'Open Water', categoryId: 'courses', category: { name: 'Courses' }, poolType: 'COURSE_POOL', isActive: true, includesComplimentaryMedia: true },
  { id: 'dive', code: 'DIV-001', name: 'Boat Dive', categoryId: 'dives', category: { name: 'Dives' }, poolType: 'DIVE_POOL', isActive: true, includesComplimentaryMedia: false },
  { id: 'archived', code: 'DIV-002', name: 'Old Dive', categoryId: 'dives', category: { name: 'Dives' }, poolType: 'DIVE_POOL', isActive: false, includesComplimentaryMedia: true },
];
test('catalogue combines category, pool, media and case-insensitive code/name searches', () => {
  const result = filterCatalogue(items, { query: ' crs-001 ', categoryId: 'courses', poolType: 'COURSE_POOL', media: 'included' }, false);
  assert.deepEqual(result.map(item => item.id), ['course']);
  assert.deepEqual(filterCatalogue(items, { ...emptyCatalogueFilters, query: 'boat' }, false).map(item => item.id), ['dive']);
  assert.deepEqual(filterCatalogue(items, { ...emptyCatalogueFilters, media: 'excluded' }, false).map(item => item.id), ['dive']);
  assert.equal(filterCatalogue(items, { ...emptyCatalogueFilters, categoryId: 'dives', poolType: 'COURSE_POOL' }, true).length, 0);
});
test('deleted-service visibility remains independent of catalogue filters', () => {
  assert.equal(filterCatalogue(items, emptyCatalogueFilters, false).length, 2);
  assert.equal(filterCatalogue(items, emptyCatalogueFilters, true).length, 3);
});
