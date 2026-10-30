import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function moduleSource(name) {
  const source = await readFile(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
}
const ratesURL = `data:text/javascript;base64,${Buffer.from(await moduleSource('personalRates')).toString('base64')}`;
const source = (await moduleSource('automaticPhotos')).replace("'./personalRates'", JSON.stringify(ratesURL));
const { addActivityWithPhoto, normalizeAutomaticPhotos, updateLinkedQuantity, removeActivityWithPhoto } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const activity = { id: 'dive', name: 'Boat dive', price: 100, category: { name: 'Dives' }, includesComplimentaryMedia: true, personalRatesJson: '{"seller":5,"photo":99,"video":99}' };
const other = { ...activity, id: 'course', name: 'Course' };
let counter = 0;
const id = () => `line-${++counter}`;
test('selecting an included activity adds a priced Photo with only one fixed photographer payment', () => {
  const lines = addActivityWithPhoto([], activity, [activity], id);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].autoPhotoFor, lines[0].clientLineId);
  assert.equal(lines[1].unitPrice, 57.5);
  assert.equal(lines.reduce((sum, line) => sum + line.lineTotal, 0), 157.5);
  assert.deepEqual(JSON.parse(lines[0].personalCommissionsJson), { seller: 5 });
  assert.deepEqual(JSON.parse(lines[1].personalCommissionsJson), { photo: 4.5 });
});
test('repeated selections and quantity edits retain one linked Photo, its photographer and discount', () => {
  let lines = addActivityWithPhoto([], activity, [activity], id);
  lines[1].photoStaffId = 'team'; lines[1].discountPercent = 10;
  lines = addActivityWithPhoto(lines, activity, [activity], id);
  assert.equal(lines.length, 2); assert.equal(lines[1].quantity, 2);
  assert.equal(lines[1].photoStaffId, 'team'); assert.equal(lines[1].lineTotal, 103.5);
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
  assert.equal(lines[0].lineTotal, 0); assert.equal(lines[1].lineTotal, 115);
  assert.equal(lines[1].photoStaffId, 'team'); assert.equal(lines[1].discountPercent, 0);
});
test('unflagged activities remain single lines and removing the flag drops the automatic Photo', () => {
  const lines = addActivityWithPhoto([], activity, [activity], id);
  const unflagged = { ...activity, includesComplimentaryMedia: false };
  const changed = normalizeAutomaticPhotos(lines, [unflagged], id);
  assert.equal(changed.length, 1); assert.equal(changed[0].includesComplimentaryMedia, false);
  assert.deepEqual(JSON.parse(changed[0].personalCommissionsJson), { seller: 5, photo: 99, video: 99 });
});
