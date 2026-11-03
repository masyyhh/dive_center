import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/utils/adminSections.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { resolveAdminSection, canUsePackageBuilder } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('property managers can open commission rules but not global property settings', () => {
  assert.equal(resolveAdminSection('commissions', 'PROPERTY_MANAGER', false), 'commissions');
  assert.equal(resolveAdminSection('properties', 'PROPERTY_MANAGER', false), 'staff');
  assert.equal(resolveAdminSection('commissions', 'GLOBAL_ADMIN', false), 'commissions');
  assert.equal(resolveAdminSection('commissions', 'CENTRE_STAFF', false), 'staff');
});
test('testing excludes the package builder, including bookmarked sections', () => {
  assert.equal(canUsePackageBuilder('testing'), false);
  assert.equal(canUsePackageBuilder('production'), true);
  assert.equal(canUsePackageBuilder(undefined), true);
  assert.equal(resolveAdminSection('packages', 'PROPERTY_MANAGER', false), 'staff');
  assert.equal(resolveAdminSection('packages', 'GLOBAL_ADMIN', false), 'properties');
  assert.equal(resolveAdminSection('packages', 'PROPERTY_MANAGER', true), 'packages');
});
