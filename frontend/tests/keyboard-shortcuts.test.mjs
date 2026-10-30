import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/keyboardShortcuts.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { workspaceShortcuts, dispatchWorkspaceShortcut } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const key = (code, patch = {}) => ({ code, altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...patch });
function dispatch(event, options = {}) {
  const actions = [];
  let prevented = false;
  dispatchWorkspaceShortcut({ ...event, preventDefault: () => { prevented = true; } }, {
    canAdmin: false, waterSportsEnabled: false, blocked: false,
    navigate: tab => actions.push(tab), openHelp: () => actions.push('help'), ...options,
  });
  return { actions, prevented };
}
test('each navigation shortcut dispatches its destination', () => {
  for (const shortcut of workspaceShortcuts(true, true).filter(shortcut => shortcut.tab)) {
    assert.deepEqual(dispatch(key(shortcut.code), { canAdmin: true, waterSportsEnabled: true }), { actions: [shortcut.tab], prevented: true });
  }
});
test('administration shortcuts are unavailable to centre staff and water sports follows its feature flag', () => {
  assert.deepEqual(dispatch(key('Digit6')), { actions: [], prevented: false });
  assert.deepEqual(dispatch(key('Digit7')), { actions: [], prevented: false });
  assert(!workspaceShortcuts(false, false).some(shortcut => ['Digit6', 'Digit7'].includes(shortcut.code)));
});
test('help can be opened without navigating', () => {
  assert.deepEqual(dispatch(key('KeyK')), { actions: ['help'], prevented: true });
});
test('typing and dialogs block both help and navigation without consuming keystrokes', () => {
  for (const code of ['Digit2', 'KeyK']) {
    assert.deepEqual(dispatch(key(code), { blocked: true }), { actions: [], prevented: false });
  }
});
test('plain keys, other modifier combinations, repeats, IME composition and handled events are ignored', () => {
  for (const patch of [{ altKey: false }, { shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { repeat: true }, { isComposing: true }, { defaultPrevented: true }]) {
    assert.deepEqual(dispatch(key('Digit2', patch)), { actions: [], prevented: false });
  }
  assert.deepEqual(dispatch(key('KeyZ')), { actions: [], prevented: false });
});
test('shortcut numbers stay stable when role and feature availability change', () => {
  for (const canAdmin of [false, true]) {
    for (const enabled of [false, true]) {
      assert.equal(workspaceShortcuts(canAdmin, enabled).find(shortcut => shortcut.tab === 'reporting').key, '5');
    }
  }
});
