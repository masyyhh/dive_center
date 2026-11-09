import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function moduleSource(name) {
  const source = await readFile(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
}
const ratesURL = `data:text/javascript;base64,${Buffer.from(await moduleSource('personalRates')).toString('base64')}`;
const photoURL = `data:text/javascript;base64,${Buffer.from(await moduleSource('photoCredits')).toString('base64')}`;
const source = (await moduleSource('automaticPhotos')).replace("'./personalRates'", JSON.stringify(ratesURL)).replace("'./photoCredits'", JSON.stringify(photoURL));
const { addActivityWithPhoto, addPackageWithPhoto, normalizeAutomaticPhotos, updateLinkedQuantity, removeActivityWithPhoto, discountSelectedQuantity } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const activity = { id: 'dive', name: 'Boat dive', price: 100, category: { name: 'Dives' }, includesComplimentaryMedia: true, personalRatesJson: '{"seller":5,"photo":99,"video":99}' };
const other = { ...activity, id: 'course', name: 'Course' };
let counter = 0;
const id = () => `line-${++counter}`;
test('selecting an included activity adds a priced Photo with only one fixed photographer payment', () => {
  const lines = addActivityWithPhoto([], activity, [activity], id);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].autoPhotoFor, lines[0].clientLineId);
  assert.equal(lines[1].unitPrice, 41.975);
  assert.equal(lines.reduce((sum, line) => sum + line.lineTotal, 0), 141.975);
  assert.deepEqual(JSON.parse(lines[0].personalCommissionsJson), { seller: 5 });
  assert.deepEqual(JSON.parse(lines[1].personalCommissionsJson), { photo: 4.5 });
});
test('repeated selections and quantity edits retain one linked Photo, its photographer and discount', () => {
  let lines = addActivityWithPhoto([], activity, [activity], id);
  lines[1].photoStaffId = 'team'; lines[1].photoStaffIds = ['team']; lines[1].discountPercent = 10;
  lines = addActivityWithPhoto(lines, activity, [activity], id);
  assert.equal(lines.length, 2); assert.equal(lines[1].quantity, 2);
  assert.equal(lines[1].photoStaffId, 'team'); assert.equal(lines[1].lineTotal, 75.555);
  lines = updateLinkedQuantity(lines, 0, -1, [activity]);
  assert.equal(lines[0].quantity, 1); assert.equal(lines[1].quantity, 1);
  assert.deepEqual(normalizeAutomaticPhotos(lines, [activity], id), lines);
});
test('removing one activity removes its Photo while keeping other pairs', () => {
  let lines = addActivityWithPhoto([], activity, [activity, other], id);
  lines = addActivityWithPhoto(lines, other, [activity, other], id);
  const kept = removeActivityWithPhoto(lines, 0);
  assert.equal(kept.length, 2); assert.equal(kept[0].itemId, 'course');
  assert.equal(kept[1].autoPhotoFor, kept[0].clientLineId);
});
test('legacy drafts move the photographer to a new Photo line and preserve the activity discount', () => {
  const lines = normalizeAutomaticPhotos([{ itemId: 'dive', itemName: 'Boat dive', categoryName: 'Dives', quantity: 2, unitPrice: 100, discountPercent: 100, lineTotal: 0, photoStaffId: 'team', videoStaffId: 'team' }], [activity], id);
  assert.equal(lines[0].photoStaffId, null); assert.equal(lines[0].videoStaffId, null);
  assert.equal(lines[0].lineTotal, 0); assert.equal(lines[1].lineTotal, 83.95);
  assert.equal(lines[1].photoStaffId, 'team'); assert.equal(lines[1].discountPercent, 0);
});
test('unflagged activities remain single lines and removing the flag drops the automatic Photo', () => {
  const lines = addActivityWithPhoto([], activity, [activity], id);
  const unflagged = { ...activity, includesComplimentaryMedia: false };
  const changed = normalizeAutomaticPhotos(lines, [unflagged], id);
  assert.equal(changed.length, 1); assert.equal(changed[0].includesComplimentaryMedia, false);
  assert.deepEqual(JSON.parse(changed[0].personalCommissionsJson), { seller: 5, photo: 99, video: 99 });
});

test('custom Photo rates apply correctly to Photo lines', () => {
  const customRates = { price: 50.0, commission: 8.0 };
  const lines = addActivityWithPhoto([], activity, [activity], id, customRates);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].unitPrice, 50.0);
  assert.deepEqual(JSON.parse(lines[1].personalCommissionsJson), { photo: 8.0 });
});

test('adding a package uses item totals without a custom-price discount and links photos', () => {
  const pkg = {
    id: 'pkg-1',
    propertyId: 'prop-1',
    name: '5 Dive Special',
    code: '5DIVE',
    price: 400, // An old saved custom price must not discount the selected items.
    isActive: true,
    items: [
      { itemId: 'dive', quantity: 5, item: activity }
    ]
  };
  const lines = addPackageWithPhoto([], pkg, [activity], id);
  assert.equal(lines.length, 2); // 1 activity line + 1 linked photo line
  assert.equal(lines[0].itemId, 'dive');
  assert.equal(lines[0].quantity, 5);
  assert.equal(lines[0].discountPercent, 0);
  assert.equal(lines[0].lineTotal, 500);
  // Linked photo line
  assert.equal(lines[1].autoPhotoFor, lines[0].clientLineId);
  assert.equal(lines[1].quantity, 5);
  assert.equal(lines[1].unitPrice, 41.975);
});

test('Photo unit rates retain three decimals while monetary totals retain two', async () => {
  const { formatMoney, formatUnitPrice } = await import(`data:text/javascript;base64,${Buffer.from(await moduleSource('format')).toString('base64')}`);
  assert.equal(formatUnitPrice(41.975), '$41.975');
  assert.equal(formatUnitPrice(57.5), '$57.50');
  assert.equal(formatUnitPrice(100, '€'), '€100.00');
  assert.equal(formatUnitPrice(null), '—');
  assert.equal(formatMoney(83.95), '$83.95');
  assert.equal(formatMoney(41.975), '$41.98');
});

test('package billing uses current catalogue prices and rejects incomplete packages', () => {
  const current = { ...activity, price: 120 };
  const pkg = { id: 'p', price: 1, items: [{ itemId: activity.id, quantity: 2, item: { ...activity, price: 50 } }] };
  const lines = addPackageWithPhoto([], pkg, [current], id);
  assert.equal(lines[0].unitPrice,120);
  assert.equal(lines[0].lineTotal,240);
  assert.equal(lines[0].discountPercent,0);
  assert.throws(() => addPackageWithPhoto([], pkg, [], id), /unavailable/);
  assert.throws(() => addPackageWithPhoto([], pkg, [{ ...current, isActive: false }], id), /unavailable/);
});


test('discounting selected activity units separates the prices and retains linked Photo quantities and staff', () => {
  let lines = addActivityWithPhoto([], activity, [activity], id);
  lines = updateLinkedQuantity(lines, 0, 2, [activity]);
  lines[0].sellerStaffId = 'seller'; lines[0].instructorStaffIds = ['one', 'two']; lines[1].photoStaffId = 'photographer'; lines[1].photoStaffIds = ['photographer', 'second'];
  const before = structuredClone(lines);
  const split = discountSelectedQuantity(lines, 0, 1, 20, id);
  assert.deepEqual(lines, before);
  assert.equal(split.length, 4);
  assert.deepEqual(split.filter(line => !line.autoPhotoFor).map(line => [line.quantity, line.discountPercent, line.lineTotal]), [[2, 0, 200], [1, 20, 80]]);
  assert.deepEqual(split.filter(line => line.autoPhotoFor).map(line => line.quantity), [2, 1]);
  for (const root of split.filter(line => !line.autoPhotoFor)) {
    assert.equal(root.sellerStaffId, 'seller'); assert.deepEqual(root.instructorStaffIds, ['one', 'two']);
    const photo = split.find(line => line.autoPhotoFor === root.clientLineId);
    assert.equal(photo.quantity, root.quantity); assert.equal(photo.photoStaffId, 'photographer'); assert.deepEqual(photo.photoStaffIds, ['photographer', 'second']); assert.equal(photo.discountPercent, 0);
  }
  assert.equal(new Set(split.map(line => line.clientLineId)).size, 4);
});
test('discounting only selected Photo units keeps the parent product undiscounted', () => {
  let lines = addActivityWithPhoto([], activity, [activity], id);
  lines = updateLinkedQuantity(lines, 0, 2, [activity]);
  const split = discountSelectedQuantity(lines, 1, 2, 50, id);
  assert.deepEqual(split.filter(line => !line.autoPhotoFor).map(line => line.discountPercent), [0, 0]);
  assert.deepEqual(split.filter(line => line.autoPhotoFor).map(line => [line.quantity, line.discountPercent]), [[1, 0], [2, 50]]);
});
test('new selections do not merge into previously discounted units and invalid partial quantities cannot change a bill', () => {
  const single = { ...activity, includesComplimentaryMedia: false };
  let lines = addActivityWithPhoto([], single, [single], id);
  lines = discountSelectedQuantity(lines, 0, 1, 10, id);
  assert.equal(addActivityWithPhoto(lines, single, [single], id).length, 2);
  for (const quantity of [0, -1, 0.5, 2, NaN]) assert.throws(() => discountSelectedQuantity(lines, 0, quantity, 20, id));
  for (const percent of [-1, 101, NaN, Infinity]) assert.throws(() => discountSelectedQuantity(lines, 0, 1, percent, id));
});
test('editing and splitting preserve saved prices, commissions and Photo sources when catalogue settings change', () => {
  const original = addActivityWithPhoto([], activity, [activity], id);
  original[0].sourceLineId = 'saved-root'; original[1].sourceLineId = 'saved-photo';
  original[0].quantity = 3; original[1].quantity = 3;
  const changed = { ...activity, includesComplimentaryMedia: false, personalRatesJson: '{"seller":99}', price: 999 };
  const normalized = normalizeAutomaticPhotos(original, [changed], id, { price: 999, commission: 999 });
  assert.equal(normalized.length, 2); assert.equal(normalized[0].unitPrice, 100); assert.equal(normalized[1].unitPrice, 41.975);
  assert.deepEqual(JSON.parse(normalized[0].personalCommissionsJson), { seller: 5 });
  assert.deepEqual(JSON.parse(normalized[1].personalCommissionsJson), { photo: 4.5 });
  const split = discountSelectedQuantity(normalized, 0, 1, 20, id);
  assert.deepEqual(split.filter(line => !line.autoPhotoFor).map(line => line.sourceLineId), ['saved-root', 'saved-root']);
  assert.deepEqual(split.filter(line => line.autoPhotoFor).map(line => line.sourceLineId), ['saved-photo', 'saved-photo']);
});
