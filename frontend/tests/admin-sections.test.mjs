import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/adminSections.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { resolveAdminSection } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('property managers can open commission rules but not global property settings', () => {
  assert.equal(resolveAdminSection('commissions', 'PROPERTY_MANAGER'), 'commissions');
  assert.equal(resolveAdminSection('properties', 'PROPERTY_MANAGER'), 'staff');
  assert.equal(resolveAdminSection('commissions', 'GLOBAL_ADMIN'), 'commissions');
  assert.equal(resolveAdminSection('commissions', 'CENTRE_STAFF'), 'staff');
});
test('removed package-builder bookmarks resolve to an available section for every administrator', () => {
  assert.equal(resolveAdminSection('packages', 'PROPERTY_MANAGER'), 'staff');
  assert.equal(resolveAdminSection('packages', 'GLOBAL_ADMIN'), 'properties');
});
