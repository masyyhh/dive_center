import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/personalRates.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { billPersonalRates } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('automatic Photo removes media assignments from the activity and retains other commission channels', () => {
  const json = billPersonalRates({ includesComplimentaryMedia: true, personalRatesJson: '{"seller":5,"photo":99,"video":99}' });
  assert.deepEqual(JSON.parse(json), { seller: 5 });
});
test('unchecked services retain their separate photo and video settings', () => {
  assert.deepEqual(JSON.parse(billPersonalRates({ includesComplimentaryMedia: false, personalRatesJson: '{"photo":12,"video":8}' })), { photo: 12, video: 8 });
});
test('invalid legacy parent rates remain safe with missing or invalid legacy rate settings', () => {
  for (const personalRatesJson of [null, '', 'broken', 'null', '[]', '{"photo":-5,"video":"99","other":500}']) {
    assert.deepEqual(JSON.parse(billPersonalRates({ includesComplimentaryMedia: true, personalRatesJson })), {});
  }
});
