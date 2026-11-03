import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/diveCentreJourney.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { signatureHasInk, remainingMinutes, guestTokenFromHash } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('guest cannot submit an empty signature or an invisible tap', () => {
  for (const strokes of [[], [[]], [[[10,10]]], [[[10,10],[10,10]]], [[[10,10],[12,12]]]]) assert.equal(signatureHasInk(strokes), false);
  assert.equal(signatureHasInk([[[10,10],[16,10]]]), true);
  assert.equal(signatureHasInk(Array.from({ length: 51 }, () => [[10,10],[16,10]])), false);
});
test('guest link countdown handles expiry and missing dates without negative values', () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  assert.equal(remainingMinutes('2026-11-02T10:20:00Z', now),20);
  assert.equal(remainingMinutes('2026-11-02T10:00:01Z', now),1);
  assert.equal(remainingMinutes('2026-11-02T10:00:00Z', now),0);
  assert.equal(remainingMinutes('2026-11-02T09:00:00Z', now),0);
  assert.equal(remainingMinutes(undefined, now),null);
  assert.equal(remainingMinutes('invalid', now),null);
});

test('new and already-issued guest links resolve the same scoped capability', () => {
  const token = 'a'.repeat(64);
  assert.equal(guestTokenFromHash('#dive-centre-tablet/' + token),token);
  assert.equal(guestTokenFromHash('#water-sports-tablet/' + token),token);
  for (const invalid of ['#dive-centre-tablet/short','#dive-centre-tablet/' + token + '/other','#dive-centre','#water-sports']) assert.equal(guestTokenFromHash(invalid),undefined);
});
