import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = readFileSync(new URL('../src/utils/auditPresentation.ts', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module, module.exports);
const { auditDetailsSummary } = module.exports;
const request = (status, method = 'GET', path = '/api/items') => JSON.stringify({ method, path, status, durationMs: 6 });
test('catalogue requests have a readable summary', () => {
  assert.equal(auditDetailsSummary(request(200)), 'Viewed catalogue. Completed successfully · Response time: 6 milliseconds.');
});
test('unsuccessful requests do not imply a successful change', () => {
  assert.match(auditDetailsSummary(request(403, 'DELETE', '/api/bills/123')), /Requested removal from bills\. Access denied/);
  assert.match(auditDetailsSummary(request(503)), /server problem/);
  assert.match(auditDetailsSummary(request(401)), /Sign-in required/);
});
test('older and non-request audit details remain readable', () => {
  assert.equal(auditDetailsSummary('Legacy note'), 'Legacy note');
  assert.equal(auditDetailsSummary('{broken'), '{broken');
  assert.equal(auditDetailsSummary(null), 'No additional details.');
  assert.equal(auditDetailsSummary('{"isActive":true}'), 'Is Active: Yes');
  assert.match(auditDetailsSummary(request(200, 'GET', '/api/unknown')), /website data/);
});
