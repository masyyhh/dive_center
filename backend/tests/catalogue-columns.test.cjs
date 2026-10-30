const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const { catalogueSpreadsheetHeaders, catalogueSpreadsheetRow, parseCatalogue } = loadTypeScript('src/services/catalogueTransfer.ts');
const item = { code: '000123', name: 'Complimentary boat dive', category: { name: 'Dives' }, price: 85, poolType: 'DIVE_POOL', poolContribution: 10, personalRatesJson: '{"seller":5,"guide":0,"instructor":12.5,"photo":20,"video":15}', includesComplimentaryMedia: true, isActive: true };
async function file(rows, format = 'xlsx') {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Catalogue');
  sheet.addRow(catalogueSpreadsheetHeaders); sheet.addRows(rows);
  return Buffer.from(await (format === 'csv' ? book.csv.writeBuffer() : book.xlsx.writeBuffer({ useSharedStrings: true }))).toString('base64');
}
test('labelled CSV and Excel columns round-trip leading-zero codes, rates, fixed payments and combined media settings', async () => {
  for (const format of ['csv', 'xlsx']) {
    const [row] = await parseCatalogue(await file([catalogueSpreadsheetRow(item)], format), format);
    assert.equal(row.code, '000123'); assert.equal(row.name, item.name);
    assert.deepEqual(row.commission, { poolType: 'DIVE_POOL', poolContribution: 10, personalRates: { seller: 5, guide: 0, instructor: 12.5, photo: 20, video: 15 }, includesComplimentaryMedia: true });
  }
});
test('all four pool choices preserve the correct amount units and inactive status', async () => {
  for (const poolType of ['COURSE_POOL', 'DIVE_POOL', 'CERTIFICATION_POOL', 'NONE']) {
    const row = catalogueSpreadsheetRow({ ...item, poolType, poolContribution: poolType === 'NONE' ? 0 : poolType === 'CERTIFICATION_POOL' ? 150 : 10, includesComplimentaryMedia: false, isActive: false });
    const [parsed] = await parseCatalogue(await file([row]), 'xlsx');
    assert.equal(parsed.commission.poolType, poolType);
    assert.equal(parsed.commission.poolContribution, poolType === 'NONE' ? 0 : poolType === 'CERTIFICATION_POOL' ? 150 : 10);
    assert.equal(parsed.isActive, false); assert.equal(parsed.commission.includesComplimentaryMedia, false);
  }
});
test('blank role cells disable payments, zero enables a zero payment, and blank media preserves its existing setting', async () => {
  const row = catalogueSpreadsheetRow(item); row[7] = null; row[12] = null;
  const [parsed] = await parseCatalogue(await file([row], 'csv'), 'csv');
  assert.equal(parsed.commission.personalRates.seller, undefined);
  assert.equal(parsed.commission.personalRates.guide, 0);
  assert.equal(parsed.commission.includesComplimentaryMedia, undefined);
});
test('labelled imports reject invalid rates, conflicting pool columns, role amounts and media settings before writing', async () => {
  for (const [index, value] of [[5, 101], [5, null], [6, 20], [8, -1], [9, 'abc'], [12, 'Maybe'], [4, 'Unknown pool']]) {
    const row = catalogueSpreadsheetRow(item); row[index] = value;
    await assert.rejects(parseCatalogue(await file([row], 'csv'), 'csv'), /Row 2/);
  }
});
test('the labelled format supports 2,000 fully populated catalogue rows within the parser limits', async () => {
  const rows = Array.from({ length: 2000 }, (_, index) => catalogueSpreadsheetRow({ ...item, code: `DIVE-${index}`, name: `Service ${index}` }));
  for (const format of ['csv', 'xlsx']) assert.equal((await parseCatalogue(await file(rows, format), format)).length, 2000);
});
