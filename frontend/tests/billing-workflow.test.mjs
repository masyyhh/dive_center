import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { fixture, descendants, text, catalogue } from './helpers/billing-fixture.mjs';
test('the actual selected-unit discount controls split the chosen quantity and leave remaining units at full price', () => {
  const f = fixture();
  f.button(f.render(), 'Discount only some units').props.onClick();
  f.input(f.render(), 'Units to discount').props.onChange({ target: { value: '1' } });
  f.input(f.render(), 'Discount (%)').props.onChange({ target: { value: '20' } });
  f.button(f.render(), 'Apply to selected units').props.onClick();
  const lines = f.states.find(value => Array.isArray(value) && value.length === 2 && value[0]?.itemId === 'dive');
  assert.deepEqual(lines.map(line => [line.quantity, line.discountPercent, line.lineTotal]), [[2, 0, 200], [1, 20, 80]]);
  assert.doesNotMatch(renderToStaticMarkup(f.render()), /Units to discount/);
});
test('invalid quantities and an unapplied selected-unit discount cannot silently alter or pass bill review', () => {
  const f = fixture();
  f.button(f.render(), 'Discount only some units').props.onClick();
  f.input(f.render(), 'Units to discount').props.onChange({ target: { value: '4' } });
  f.button(f.render(), 'Apply to selected units').props.onClick();
  assert.match(renderToStaticMarkup(f.render()), /Choose a whole quantity on this line/);
  f.button(f.render(), 'Review bill').props.onClick();
  assert.match(renderToStaticMarkup(f.render()), /Apply or cancel the selected-unit discount/);
});

test('compact billing is confined to Siyam World and mounts a single copy of each field', () => {
  for (const name of ['Siyam World', 'Sun Siyam World', 'Iru Fushi', 'Sun Siyam Vilu Reef']) {
    const tree = fixture(name).render();
    const compact = name.includes('World');
    assert.equal(descendants(tree, node => node.props.className === 'siyam-checkout').length, compact ? 1 : 0);
    assert.equal(descendants(tree, node => node.props.className === 'billing-toolbar-top').length, compact ? 0 : 1);
    assert.equal(descendants(tree, node => node.props.className === 'billing-draft-status').length, compact ? 0 : 1);
    for (const id of ['bill-room', 'bill-guest', 'bill-check-number', 'bill-business-date', 'checkout-discount', 'newbillview-field-10']) {
      assert.equal(descendants(tree, node => node.props.id === id).length, 1, `${name}: ${id}`);
    }
  }
});
test('Siyam World footer updates the same bill discount and tip state and retains line controls', () => {
  const f = fixture('Siyam World');
  let tree = f.render();
  descendants(tree, node => node.props.id === 'checkout-discount')[0].props.onChange({ target: { value: '10' } });
  descendants(tree, node => node.props.id === 'newbillview-field-10')[0].props.onChange({ target: { value: '5' } });
  tree = f.render();
  const footer = descendants(tree, node => node.props.className === 'siyam-checkout')[0];
  assert.match(text(footer), /\$270.00/);
  assert.match(text(footer), /\$349.52/); // 270 + 27 service + 47.52 tax + 5 tip
  assert.ok(f.button(tree, 'Discount only some units'));
  assert.ok(f.button(tree, 'Save'));
  assert.equal(descendants(footer, node => node.type === 'button' && text(node) === 'Save').length, 0);
  const toolbar = descendants(tree, node => node.props.className === 'billing-toolbar')[0];
  assert.equal(descendants(toolbar, node => node.type === 'button' && text(node) === 'Save').length, 1);
});

test('guest controls keep leading zeros and update the guest on both bill layouts', () => {
  for (const property of ['Iru Fushi', 'Siyam World']) {
    const f = fixture(property);
    descendants(f.render(), node => node.props.id === 'bill-room')[0].props.onChange({ target: { value: '0009' } });
    descendants(f.render(), node => node.props.id === 'bill-guest')[0].props.onChange({ target: { value: 'Updated Guest' } });
    const tree = f.render();
    assert.equal(descendants(tree, node => node.props.id === 'bill-room')[0].props.value, '0009');
    assert.equal(descendants(tree, node => node.props.id === 'bill-guest')[0].props.value, 'Updated Guest');
  }
});
test('locked payroll blocks bill review in both layouts', () => {
  for (const property of ['Iru Fushi', 'Siyam World']) {
    const f = fixture(property, { locked: true });
    f.button(f.render(), property === 'Siyam World' ? 'Save' : 'Review bill').props.onClick();
    assert.match(renderToStaticMarkup(f.render()), /Choose a business date in an open month before saving/);
    assert.equal(f.button(f.render(), 'Confirm & Save'), undefined);
  }
});
test('invalid checkout discount remains an inline error after moving the shared controls', () => {
  for (const property of ['Iru Fushi', 'Siyam World']) {
    const f = fixture(property);
    descendants(f.render(), node => node.props.id === 'checkout-discount')[0].props.onChange({ target: { value: '101' } });
    const tree = f.render();
    assert.equal(descendants(tree, node => node.props.id === 'checkout-discount')[0].props['aria-invalid'], true);
    assert.ok(text(descendants(tree, node => node.props.id === 'checkout-discount-error')[0]).length > 0);
  }
});

test('Siyam catalogue stays available beside the draft without the old activity popover', () => {
  const f = fixture('Siyam World');
  const tree = f.render();
  assert.equal(descendants(tree, node => node.props.className === 'siyam-activity-picker').length, 0);
  assert.equal(descendants(tree, node => node.props.className === 'catalogue-tree').length, 1);
  assert.equal(descendants(tree, node => node.props.id === 'bill-room')[0].props.value, '0012');
  assert.equal(descendants(tree, node => node.props.id === 'bill-guest')[0].props.value, 'Test Guest');
  assert.equal(f.button(tree, 'Save').type, 'button');
});

test('Siyam activity and package entries show only names and retain their add actions', () => {
  const item = { id: 'course', name: 'Discover Scuba', code: 'CRS-01', price: 100, poolType: 'COURSE_POOL', poolContribution: 10, includesComplimentaryMedia: true };
  const pkg = { id: 'package', name: 'Five dives', code: 'PKG-5', description: 'Package description', items: [{ itemId: 'course', quantity: 5 }] };
  const added = [];
  const model = { compactBilling: true, canManage: true, currencySymbol: '$', filteredItems: [item], filteredPackages: [pkg], items: [item], packages: [pkg], categories: [], photoRates: {}, searchQuery: '', selectedCategory: 'ALL', setSearchQuery() {}, setSelectedCategory() {}, handleAddItem: value => added.push(value.id), handleAddPackage: value => added.push(value.id) };
  for (const [selectedCategory, name, id] of [['ALL', item.name, item.id], ['PACKAGES', pkg.name, pkg.id]]) {
    const tree = catalogue({ ...model, selectedCategory });
    const button = descendants(tree, node => node.props['aria-label'] === `Add ${name} to bill`)[0];
    assert.equal(text(button), name);
    button.props.onClick();
    assert.equal(added.at(-1), id);
  }
  const standard = catalogue({ ...model, compactBilling: false });
  assert.match(text(standard), /CRS-01/);
  assert.match(text(standard), /Course Pool/);
});

test('Siyam catalogue presents collapsed category folders and keeps items under their own category', () => {
  const categories = [{ id: 'dives', name: 'Diving' }, { id: 'courses', name: 'Courses' }];
  const items = [
    { id: 'dive', categoryId: 'dives', name: 'Single Dive', isActive: true },
    { id: 'course', categoryId: 'courses', name: 'Open Water', isActive: true },
    { id: 'archived', categoryId: 'dives', name: 'Archived Dive', isActive: false },
  ];
  const tree = catalogue({ compactBilling: true, categories, items, packages: [], setupLoading: false, handleAddItem() {} });
  const folders = descendants(tree, node => node.type === 'details');
  assert.equal(folders.length, 2);
  assert.ok(folders.every(folder => !folder.props.open));
  assert.deepEqual(folders.map(folder => text(descendants(folder, node => node.type === 'summary')[0])), ['Diving', 'Courses']);
  assert.equal(text(descendants(folders[0], node => node.type === 'button')[0]), 'Single Dive');
  assert.equal(text(descendants(folders[1], node => node.type === 'button')[0]), 'Open Water');
  assert.equal(descendants(tree, node => node.type === 'input').length, 0);
  assert.doesNotMatch(text(tree), /Archived Dive/);
});

test('Siyam World guest fields remain visible and invalid discounts expose their controls', () => {
  const f = fixture('Siyam World', { draft: { roomNumber: '', guestName: '' } });
  const tree = f.render();
  assert.equal(descendants(tree, node => node.props.id === 'bill-guest-details')[0].type, 'div');
  for (const id of ['bill-room', 'bill-guest', 'newbillview-field-3', 'newbillview-field-4']) assert.equal(descendants(tree, node => node.props.id === id).length, 1);
  descendants(tree, node => node.props.id === 'checkout-discount')[0].props.onChange({ target: { value: '101' } });
  assert.equal(descendants(f.render(), node => node.props.id === 'checkout-discount')[0].props['aria-invalid'], true);
});

test('Siyam World assigns every commission role in the service row without opening a detail row', async () => {
  const f = fixture('Siyam World', { runControllerEffects: true, draft: { billLines: [{ clientLineId: 'root', itemId: 'dive', itemName: 'Dive', quantity: 1, unitPrice: 100, discountPercent: 0, lineTotal: 100, personalCommissionsJson: JSON.stringify({ seller: 10, guide: 5, instructor: 20, photo: 4.5, video: 4 }) }] }, apiFetch: async url => {
    if (url.startsWith('/items')) return { items: [], categories: [] };
    if (url.startsWith('/staff')) return { staff: [{ id: 'one', name: 'First', roleTitle: 'Instructor' }, { id: 'two', name: 'Second', roleTitle: 'Instructor' }] };
    if (url.startsWith('/packages')) return { packages: [] };
    return { nextCheckNumber: 1001 };
  } });
  f.render();
  const cleanup = f.controllerEffects.map(effect => effect()).filter(Boolean);
  await new Promise(resolve => setImmediate(resolve));
  const field = label => descendants(f.render(), node => node.props['aria-label'] === `${label} for Dive`)[0];
  assert.equal(field('Seller').props.disabled, false);
  field('Seller').props.onChange({ target: { value: 'one' } });
  field('Guide').props.onChange({ target: { value: 'two' } });
  field('Video').props.onChange({ target: { value: 'two' } });
  field('Instructors').props.onChange({ target: { selectedOptions: [{ value: 'one' }, { value: 'two' }] } });
  field('Photo staff').props.onChange({ target: { selectedOptions: [{ value: 'one' }, { value: 'two' }] } });
  assert.equal(field('Seller').props.value, 'one');
  assert.equal(field('Guide').props.value, 'two');
  assert.equal(field('Video').props.value, 'two');
  assert.deepEqual(field('Instructors').props.value, ['one', 'two']);
  assert.deepEqual(field('Photo staff').props.value, ['one', 'two']);
  field('Instructors').props.onChange({ target: { selectedOptions: [] } });
  assert.deepEqual(field('Instructors').props.value, []);
  assert.deepEqual(field('Photo staff').props.value, ['one', 'two']);
  const tree = f.render();
  assert.equal(descendants(tree, node => node.props.id?.startsWith('siyam-line-details')).length, 0);
  assert.equal(descendants(tree, node => node.props.className === 'siyam-staff-cell').length, 1);
  assert.equal(field('Unit price').props.value, 100);
  assert.equal(field('Final price').props.value, 100);
  cleanup.forEach(dispose => dispose());
});

test('the redesigned workspace is exclusive to Siyam World; other properties keep the original view', () => {
  for (const name of ['Iru Fushi', 'Sun Siyam Vilu Reef', 'Olhuveli', 'Siyam World', 'Sun Siyam World']) {
    const tree = fixture(name).render();
    const compact = name.endsWith('World');
    assert.equal(descendants(tree, node => node.props.className === 'bill-builder siyam-bill siyam-ledger').length, compact ? 1 : 0);
    assert.equal(descendants(tree, node => node.props.className === 'catalogue-tree').length, compact ? 1 : 0);
    assert.equal(descendants(tree, node => node.props.id === 'bill-guest-details')[0].type, 'div');
    assert.equal(descendants(tree, node => node.props.className === 'billing-toolbar-total').length, compact ? 0 : 1);
    assert.equal(descendants(tree, node => node.props.className === 'bill-breakdown').length, 0);
    assert.equal(descendants(tree, node => node.props.id === 'bill-notes').length, compact ? 0 : 1);
    assert.equal(/siyam-lines-table/.test(renderToStaticMarkup(tree)), compact);
  }
});

test('Siyam World ledger quantity and discount cells use the existing bill calculations', () => {
  const f = fixture('Siyam World');
  descendants(f.render(), node => node.props['aria-label'] === 'Increase quantity for Dive')[0].props.onClick();
  descendants(f.render(), node => node.props['aria-label'] === 'Discount percentage for Dive')[0].props.onChange({ target: { value: '20' } });
  const lines = f.states.find(value => Array.isArray(value) && value[0]?.itemId === 'dive');
  assert.equal(lines[0].quantity, 4);
  assert.equal(lines[0].discountPercent, 20);
  assert.equal(lines[0].lineTotal, 320);
});

test('editing individual unit and final prices recalculates discounted lines and checkout charges', () => {
  const f = fixture('Siyam World');
  const field = label => descendants(f.render(), node => node.props['aria-label'] === label)[0];
  field('Unit price for Dive').props.onChange({ target: { value: '80' } });
  assert.equal(field('Final price for Dive').props.value, 240);
  field('Discount percentage for Dive').props.onChange({ target: { value: '20' } });
  field('Final price for Dive').props.onChange({ target: { value: '150' } });
  assert.equal(field('Unit price for Dive').props.value, 62.5);
  assert.equal(field('Discount percentage for Dive').props.value, 20);
  const footer = descendants(f.render(), node => node.props.className === 'siyam-checkout')[0];
  assert.match(text(footer), /\$150.00/);
  assert.match(text(footer), /\$191.40/);
  field('Unit price for Dive').props.onChange({ target: { value: '-10' } });
  assert.equal(field('Unit price for Dive').props.value, 62.5);
  assert.match(text(f.render()), /Enter a valid price/);
});

test('selected product changes affect only checked rows and keep other product prices intact', () => {
  const lines = [
    { clientLineId: 'dive', itemId: 'dive', itemName: 'Dive', quantity: 3, unitPrice: 100, discountPercent: 0, lineTotal: 300 },
    { clientLineId: 'fins', itemId: 'fins', itemName: 'Fins', quantity: 1, unitPrice: 20, discountPercent: 0, lineTotal: 20 },
  ];
  const f = fixture('Siyam World', { draft: { billLines: lines } });
  const field = label => descendants(f.render(), node => node.props['aria-label'] === label)[0];
  assert.equal(f.button(f.render(), 'Select products'), undefined);
  const row = id => descendants(f.render(), node => node.props['data-bill-line'] === id)[0];
  const click = (id, modifiers = {}) => row(id).props.onClick({ target: { closest: () => null }, ...modifiers });
  assert.equal(field('Select Dive'), undefined);
  assert.equal(row('dive').props['aria-selected'], false);
  click('dive', { ctrlKey: true });
  field('Selected product value').props.onChange({ target: { value: '25' } });
  f.button(f.render(), 'Apply to selected').props.onClick();
  assert.equal(field('Final price for Dive').props.value, 225);
  assert.equal(field('Final price for Fins').props.value, 20);
  field('Selected product adjustment').props.onChange({ target: { value: 'unitPrice' } });
  field('Selected product value').props.onChange({ target: { value: '80' } });
  f.button(f.render(), 'Apply to selected').props.onClick();
  assert.equal(field('Unit price for Dive').props.value, 80);
  assert.equal(field('Final price for Dive').props.value, 180);
  assert.equal(field('Unit price for Fins').props.value, 20);
  f.button(f.render(), 'Clear selection').props.onClick();
  assert.equal(f.button(f.render(), 'Apply to selected'), undefined);
  assert.equal(row('dive').props['aria-selected'], false);
  click('dive');
  click('fins', { ctrlKey: true });
  assert.equal(row('dive').props['aria-selected'], true);
  assert.equal(row('fins').props['aria-selected'], true);
  click('dive', { metaKey: true });
  assert.equal(row('dive').props['aria-selected'], false);
  assert.equal(row('fins').props['aria-selected'], true);
  row('dive').props.onClick({ ctrlKey: true, target: { closest: () => ({}) } });
  assert.equal(row('dive').props['aria-selected'], false);
  const keyboardRow = row('dive');
  const target = {};
  keyboardRow.props.onKeyDown({ key: 'a', ctrlKey: true, target, currentTarget: target, preventDefault() {} });
  assert.equal(row('dive').props['aria-selected'], true);
  row('dive').props.onKeyDown({ key: 'Escape', target, currentTarget: target, preventDefault() {} });
  assert.equal(row('dive').props['aria-selected'], false);
  assert.equal(row('fins').props['aria-selected'], false);
});

test('Siyam Save posts once without confirmation, retains failed drafts and permits retry', async () => {
  const calls = [], saved = [];
  let finish;
  const document = { getElementById: () => ({ focus() {}, scrollIntoView() {} }) };
  const f = fixture('Siyam World', { runControllerEffects: true, document, onBillSaved: check => saved.push(check), apiFetch: async (url, options = {}) => {
    if (options.method) { calls.push({ url, ...options }); return new Promise((resolve, reject) => { finish = { resolve, reject }; }); }
    if (url.startsWith('/items')) return { items: [], categories: [] };
    if (url.startsWith('/staff')) return { staff: [] };
    if (url.startsWith('/packages')) return { packages: [] };
    if (url.startsWith('/bills/next-check')) return { nextCheckNumber: 1001 };
    throw Error(`Unexpected request ${url}`);
  } });
  f.render();
  const cleanup = f.controllerEffects.map(effect => effect()).filter(Boolean);
  await new Promise(resolve => setImmediate(resolve));
  const button = f.button(f.render(), 'Save');
  assert.equal(button.props.disabled, false);
  const pending = button.props.onClick();
  button.props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/bills');
  assert.equal(calls[0].method, 'POST');
  assert.equal(JSON.parse(calls[0].body).items[0].lineTotal, 300);
  assert.equal(f.button(f.render(), 'Confirm & Save'), undefined);
  assert.equal(f.button(f.render(), 'Saving…').props.disabled, true);
  finish.reject(new Error('Connection failed'));
  await pending;
  assert.match(text(f.render()), /Connection failed/);
  assert.equal(descendants(f.render(), node => node.props.id === 'bill-guest')[0].props.value, 'Test Guest');
  assert.deepEqual(saved, []);
  const retry = f.button(f.render(), 'Save').props.onClick();
  assert.equal(calls.length, 2);
  finish.resolve({});
  await retry;
  assert.deepEqual(saved, [1001]);
  const next = f.render();
  assert.match(text(next), /Bill #1001 saved successfully/);
  assert.equal(descendants(next, node => node.props.id === 'bill-room')[0].props.value, '');
  assert.equal(descendants(next, node => node.props.id === 'bill-guest')[0].props.value, '');
  assert.equal(descendants(next, node => node.props.id === 'bill-check-number')[0].props.value, 1002);
  assert.equal(descendants(next, node => node.props['aria-label'] === 'Final price for Dive').length, 0);
  assert.ok(f.button(next, 'Save'));
  cleanup.forEach(dispose => dispose());
});


test('final bill summary keeps checkout calculations and optional tip in sync', () => {
  const f = fixture('Iru Fushi');
  const summary = () => descendants(f.render(), node => node.props['aria-label'] === 'Final bill total')[0];
  assert.match(text(summary()), /Gross total\$300.00/);
  assert.doesNotMatch(text(summary()), /Checkout discount|Guest tip|All activities, packages/);
  descendants(f.render(), node => node.props.id === 'checkout-discount')[0].props.onChange({ target: { value: '10' } });
  descendants(f.render(), node => node.props.id === 'newbillview-field-10')[0].props.onChange({ target: { value: '5' } });
  const result = summary();
  assert.match(text(result), /Checkout discount \(10%\)−\$30.00/);
  assert.match(text(result), /Service charge \(10%\)\$27.00/);
  assert.match(text(result), /Tax \/ TGST \(16%\)\$47.52/);
  assert.match(text(result), /Guest tip\$5.00/);
  assert.equal(text(descendants(result, node => node.props['aria-live'] === 'polite')[0]), '$349.52');
});
