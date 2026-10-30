import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/commissionEditor.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { hasNoCommissions, readCommissionSelections, serializeCommissionSelections } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('editing existing commissions preserves valid amounts and discovers rates missing from the role list', () => {
  const rows = readCommissionSelections(' seller ,guide', '{"seller":5,"guide":10,"instructor":12.5}');
  const saved = serializeCommissionSelections(rows);
  assert.equal(saved.personalRoles, 'seller,guide,instructor');
  assert.deepEqual(JSON.parse(saved.personalRatesJson), { seller: 5, guide: 10, instructor: 12.5 });
});
test('unchecking a role removes its payment and clearing every role disables all personal commissions', () => {
  const rows = readCommissionSelections('seller,guide', '{"seller":5,"guide":10}');
  rows.find(row => row.role === 'seller').enabled = false;
  assert.deepEqual(JSON.parse(serializeCommissionSelections(rows).personalRatesJson), { guide: 10 });
  for (const row of rows) row.enabled = false;
  assert.deepEqual(serializeCommissionSelections(rows), { personalRoles: '', personalRatesJson: '{}' });
});
test('selected blank, negative or nonnumeric payments cannot be saved; explicit zero is supported', () => {
  for (const amount of ['', '  ', '-1', 'bad', 'Infinity']) {
    const rows = readCommissionSelections('seller', '{}');
    rows.find(row => row.role === 'seller').amount = amount;
    assert.throws(() => serializeCommissionSelections(rows), /Seller/);
  }
  const rows = readCommissionSelections('seller', '{"seller":0}');
  assert.deepEqual(JSON.parse(serializeCommissionSelections(rows).personalRatesJson), { seller: 0 });
});
test('combined media preserves dormant separate rates when other roles change', () => {
  const rows = readCommissionSelections('seller,photo,video', '{"seller":5,"photo":12,"video":8}');
  rows.find(row => row.role === 'seller').amount = '6.5';
  assert.deepEqual(JSON.parse(serializeCommissionSelections(rows, true).personalRatesJson), { seller: 6.5, photo: 12, video: 8 });
});
test('invalid legacy settings prompt for selected role amounts and do not enable unsupported roles', () => {
  for (const json of ['broken', 'null', '[]']) {
    const rows = readCommissionSelections('guide,unsupported', json);
    assert.equal(rows.find(row => row.role === 'guide').enabled, true);
    assert.throws(() => serializeCommissionSelections(rows), /Guide/);
  }
  const rows = readCommissionSelections('', '{"photo":-5,"unsupported":999}');
  assert(rows.every(row => !row.enabled));
});

test('no-commission activities are distinguished from a no-pool service with fixed employee payments', () => {
  const none = { poolType: 'NONE', personalRoles: '', personalRatesJson: '{}', includesComplimentaryMedia: false };
  assert.equal(hasNoCommissions(none), true);
  assert.equal(hasNoCommissions({ ...none, personalRatesJson: '{"seller":0}' }), true);
  assert.equal(hasNoCommissions({ ...none, personalRatesJson: '{"seller":5}' }), false);
  assert.equal(hasNoCommissions({ ...none, includesComplimentaryMedia: true }), false);
  assert.equal(hasNoCommissions({ ...none, poolType: 'DIVE_POOL' }), false);
  assert.equal(hasNoCommissions({ ...none, personalRoles: 'seller', personalRatesJson: 'broken' }), false);
});
