import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { fixture, descendants, text } from './helpers/billing-fixture.mjs';
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
  assert.ok(f.button(tree, 'Review & save'));
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
    f.button(f.render(), property === 'Siyam World' ? 'Review & save' : 'Review bill').props.onClick();
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

test('opening the activity picker preserves the draft and guest fields', () => {
  const f = fixture('Siyam World');
  let tree = f.render();
  assert.equal(descendants(tree, node => node.props.className === 'siyam-activity-picker')[0].props.open, false);
  descendants(tree, node => node.props.className === 'siyam-activity-picker')[0].props.onToggle({ currentTarget: { open: true } });
  tree = f.render();
  assert.equal(descendants(tree, node => node.props.className === 'siyam-activity-picker')[0].props.open, true);
  assert.equal(descendants(tree, node => node.props.id === 'bill-room')[0].props.value, '0012');
  assert.equal(descendants(tree, node => node.props.id === 'bill-guest')[0].props.value, 'Test Guest');
  assert.match(text(tree), /Dive/);
});

test('Siyam World guest fields remain visible and invalid discounts expose their controls', () => {
  const f = fixture('Siyam World', { draft: { roomNumber: '', guestName: '' } });
  const tree = f.render();
  assert.equal(descendants(tree, node => node.props.id === 'bill-guest-details')[0].type, 'div');
  for (const id of ['bill-room', 'bill-guest', 'newbillview-field-3', 'newbillview-field-4']) assert.equal(descendants(tree, node => node.props.id === id).length, 1);
  descendants(tree, node => node.props.id === 'checkout-discount')[0].props.onChange({ target: { value: '101' } });
  assert.equal(descendants(f.render(), node => node.props.id === 'checkout-discount')[0].props['aria-invalid'], true);
});

test('Siyam World line options expand without changing quantities or prices', () => {
  const f = fixture('Siyam World');
  let tree = f.render();
  assert.equal(descendants(tree, node => node.props.id === 'siyam-line-details-0')[0].props.hidden, true);
  descendants(tree, node => node.props['aria-controls'] === 'siyam-line-details-0')[0].props.onClick();
  tree = f.render();
  assert.equal(descendants(tree, node => node.props.id === 'siyam-line-details-0')[0].props.hidden, false);
  assert.match(renderToStaticMarkup(tree), /€?300.00|\$300.00/);
});

test('the redesigned workspace is exclusive to Siyam World; other properties keep the original view', () => {
  for (const name of ['Iru Fushi', 'Sun Siyam Vilu Reef', 'Olhuveli', 'Siyam World', 'Sun Siyam World']) {
    const tree = fixture(name).render();
    const compact = name.endsWith('World');
    assert.equal(descendants(tree, node => node.props.className === 'bill-builder siyam-bill siyam-ledger').length, compact ? 1 : 0);
    assert.equal(descendants(tree, node => node.props.className === 'siyam-activity-picker').length, compact ? 1 : 0);
    assert.equal(descendants(tree, node => node.props.id === 'bill-guest-details')[0].type, 'div');
    assert.equal(descendants(tree, node => node.props.className === 'billing-toolbar-total').length, compact ? 0 : 1);
    assert.equal(descendants(tree, node => node.props.className === 'bill-breakdown').length, compact ? 1 : 0);
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
