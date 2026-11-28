import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const source = readFileSync(
  new URL('../src/components/InstructorPicker.tsx', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
function load() {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react')
        return { ...React, useState: (value) => [value, () => {}], useId: () => 'instructor-help' };
      if (name === '../utils/format')
        return { formatMoney: (amount, symbol) => symbol + amount.toFixed(2) };
      throw Error('Unexpected dependency ' + name);
    },
    module,
    module.exports,
  );
  return module.exports.InstructorPicker;
}
const Picker = load();
const base = {
  staff: [
    { id: 'one', name: 'First Instructor', roleTitle: 'Instructor' },
    { id: 'two', name: 'Second Instructor', roleTitle: 'Instructor' },
  ],
  selectedIds: ['one'],
  disabled: false,
  onChange() {},
  unitRate: 10,
  quantity: 3,
  discountPercent: 20,
  currencySymbol: '$',
};
const nodes = (node) =>
  !React.isValidElement(node)
    ? []
    : [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
test('instructor checkboxes add/remove recipients without replacing other selections', () => {
  let selected;
  let tree = Picker({
    ...base,
    onChange: (ids) => {
      selected = ids;
    },
  });
  let boxes = nodes(tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox');
  assert.equal(boxes[0].props.checked, true);
  assert.equal(boxes[1].props.checked, false);
  boxes[1].props.onChange({ target: { checked: true } });
  assert.deepEqual(selected, ['one', 'two']);
  tree = Picker({
    ...base,
    selectedIds: selected,
    onChange: (ids) => {
      selected = ids;
    },
  });
  boxes = nodes(tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox');
  boxes[0].props.onChange({ target: { checked: false } });
  assert.deepEqual(selected, ['two']);
});
test('each instructor displays the full discounted catalogue amount and the aggregate includes every selection', () => {
  const html = renderToStaticMarkup(Picker({ ...base, selectedIds: ['one', 'two'] }));
  assert.match(html, /\$24\.00 each/);
  assert.match(html, /\$48\.00/);
  assert.match(html, /2 selected/);
  assert.equal(nodes(Picker({ ...base, disabled: true }))[0].props.disabled, true);
});
test('empty staff and zero selections give clear feedback', () => {
  const html = renderToStaticMarkup(Picker({ ...base, staff: [], selectedIds: [] }));
  assert.match(html, /No eligible staff available/);
  assert.match(html, /0 selected/);
  assert.match(html, /\$0\.00/);
});

test('Photo mode shares the commission pool across selected staff', () => {
  const html = renderToStaticMarkup(
    Picker({ ...base, role: 'photo', selectedIds: ['one', 'two'] }),
  );
  assert.match(html, /Photo staff/);
  assert.match(html, /Photo commission total/);
  assert.match(html, /\$12\.00 each/);
  assert.match(html, /\$24\.00/);
});

test('four photos at 4.50 show 9 each for two people', () => {
  const html = renderToStaticMarkup(
    Picker({
      ...base,
      role: 'photo',
      selectedIds: ['one', 'two'],
      quantity: 4,
      unitRate: 4.5,
      discountPercent: 0,
    }),
  );
  assert.match(html, /\$9\.00 each/);
  assert.match(html, /\$18\.00/);
});
test('Photo remainder cents preserve the pool total', () => {
  const html = renderToStaticMarkup(
    Picker({
      ...base,
      role: 'photo',
      selectedIds: ['one', 'two'],
      quantity: 1,
      unitRate: 0.05,
      discountPercent: 0,
    }),
  );
  assert.match(html, /\$0\.02 each/);
  assert.match(html, /extra cent/);
  assert.match(html, /\$0\.05/);
});
