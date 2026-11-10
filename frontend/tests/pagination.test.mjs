import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/components/PaginatedCollection.tsx', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const nodes = node => !React.isValidElement(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
function fixture() {
  let state;
  const module = { exports: {} };
  new Function('require','module','exports',js)(name => name === 'react' ? { ...React, useId: () => 'page-size', useEffect: callback => callback(), useState: initial => { state ??= initial; return [state, update => { state = typeof update === 'function' ? update(state) : update; }]; } } : require(name), module, module.exports);
  const render = (count = 61, prefix = 'row', list = false) => {
    const rows = Array.from({ length: count }, (_, index) => React.createElement(list ? 'li' : 'tr', { key: prefix + index, 'data-row': index }, list ? `Item ${index}` : React.createElement('td', null, `Item ${index}`)));
    const children = list ? React.createElement('ul', null, rows) : React.createElement('table', null, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', null, 'Name'))), React.createElement('tbody', null, rows), React.createElement('tfoot', null, React.createElement('tr', null, React.createElement('td', null, 'Full dataset total'))));
    return module.exports.PaginatedCollection({ label: 'Records', children });
  };
  const button = (tree, name) => nodes(tree).find(node => node.props['aria-label'] === name);
  const visible = tree => nodes(tree).filter(node => node.props['data-row'] !== undefined && !node.props.className?.includes('pagination-row-hidden')).map(node => node.props['data-row']);
  return { render, button, visible };
}
test('table and list pagination visit every row without dropping print data or table totals', () => {
  for (const list of [false, true]) {
    const f = fixture(); let tree = f.render(61, 'row', list);
    assert.deepEqual(f.visible(tree), Array.from({ length: 25 }, (_, i) => i));
    assert.equal(f.button(tree, 'Previous page of Records').props.disabled, true);
    f.button(tree, 'Next page of Records').props.onClick(); tree = f.render(61, 'row', list);
    assert.equal(f.visible(tree)[0], 25);
    f.button(tree, 'Last page of Records').props.onClick(); tree = f.render(61, 'row', list);
    assert.deepEqual(f.visible(tree), Array.from({ length: 11 }, (_, i) => i + 50));
    assert.equal(f.button(tree, 'Next page of Records').props.disabled, true);
    assert.equal(nodes(tree).filter(node => node.props['data-row'] !== undefined).length, 61);
    if (!list) assert.equal(nodes(tree).filter(node => node.type === 'tfoot').length, 1);
    f.button(tree, 'First page of Records').props.onClick(); assert.equal(f.visible(f.render(61, 'row', list))[0], 0);
  }
});
test('changing page size or filtered results resets safely and empty/small lists omit pagination', () => {
  const f = fixture(); let tree = f.render();
  f.button(tree, 'Last page of Records').props.onClick(); tree = f.render();
  nodes(tree).find(node => node.type === 'select').props.onChange({ target: { value: '10' } });
  assert.equal(f.visible(f.render()).length, 10);
  f.button(f.render(), 'Next page of Records').props.onClick();
  assert.equal(f.visible(f.render(3, 'filtered'))[0], 0);
  assert.equal(f.visible(f.render())[0], 0);
  assert.equal(nodes(f.render(0)).filter(node => node.type === 'nav').length, 0);
  assert.equal(nodes(f.render(8)).filter(node => node.type === 'nav').length, 0);
});
