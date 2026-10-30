const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const { parseCatalogue, commissionCell } = loadTypeScript('src/services/catalogueTransfer.ts');

async function catalogue(format, commission, category = 'Certifications') {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Catalogue');
  sheet.addRow(['Item Code', 'Items', 'Category', 'Price', 'Commission', 'Status']);
  sheet.addRow(['CERT-001', 'Open Water Certification', category, 100, commission, 'Active']);
  return Buffer.from(await (format === 'csv' ? book.csv.writeBuffer() : book.xlsx.writeBuffer())).toString('base64');
}
test('certifications numeric commission uses its own pool in CSV and Excel', async () => {
  for (const format of ['csv', 'xlsx']) {
    const rows = await parseCatalogue(await catalogue(format, 20), format);
    assert.equal(rows[0].category, 'Certifications');
    assert.deepEqual(rows[0].commission, { poolType: 'CERTIFICATION_POOL', poolContribution: 20, personalRates: {} });
  }
});
test('certification commission settings round-trip without losing personal rates', async () => {
  const settings = { poolType: 'CERTIFICATION_POOL', poolContribution: 25, personalRatesJson: '{"instructor":12}' };
  for (const format of ['csv', 'xlsx']) {
    const [row] = await parseCatalogue(await catalogue(format, commissionCell(settings)), format);
    assert.deepEqual(row.commission, { poolType: 'CERTIFICATION_POOL', poolContribution: 25, personalRates: { instructor: 12 } });
  }
});
test('certification category inference leaves course and dive pools unchanged', async () => {
  for (const [category, poolType] of [['Certification', 'CERTIFICATION_POOL'], ['CERTIFICATIONS', 'CERTIFICATION_POOL'], ['Courses', 'COURSE_POOL'], ['Dives', 'DIVE_POOL']]) {
    const [row] = await parseCatalogue(await catalogue('csv', 5, category), 'csv');
    assert.equal(row.commission.poolType, poolType);
  }
});
