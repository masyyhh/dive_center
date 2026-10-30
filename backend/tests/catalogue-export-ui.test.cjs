const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const { parseCatalogue, catalogueSpreadsheetHeaders } = loadTypeScript('src/services/catalogueTransfer.ts');
const item = { code: '000123', name: 'Sample dive', category: { name: 'Dives', propertyId: 'a' }, price: 85, poolType: 'DIVE_POOL', poolContribution: 10, personalRatesJson: '{"seller":5,"photo":99,"video":20}', includesComplimentaryMedia: true, isActive: true };
const { itemsRouter } = loadTypeScript('src/routes/items.routes.ts', {
  '../db': { prisma: { item: { findMany: async () => [item] } } },
  '../middleware/auth': { requireAuth: (req, res, next) => next() },
  '../services/auditService': { logAuditEvent: async () => {} },
});
function exportFile(format, template) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: '/export', body: {}, headers: {}, query: { propertyId: 'a', format, template: String(template) }, user: { role: 'PROPERTY_MANAGER', assignedPropertyIds: ['a'] } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, setHeader() {}, json(body) { resolve({ status: this.statusCode, body }); }, send(bytes) { resolve({ status: this.statusCode, bytes }); } };
    itemsRouter.handle(req, res, error => reject(error || new Error('No response')));
  });
}
test('actual exports and templates use labelled columns and remain importable as CSV and Excel', async () => {
  for (const format of ['csv', 'xlsx']) for (const template of [false, true]) {
    const result = await exportFile(format, template);
    assert.equal(result.status, 200);
    const [row] = await parseCatalogue(result.bytes.toString('base64'), format);
    assert.equal(row.commission.poolType, 'DIVE_POOL'); assert.equal(row.commission.poolContribution, 10);
    assert.equal(row.commission.includesComplimentaryMedia, !template);
    assert.equal(row.code, template ? '' : '000123');
    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook(); await book.xlsx.load(result.bytes);
      const sheet = book.getWorksheet('Catalogue');
      assert.deepEqual(sheet.getRow(1).values.slice(1), catalogueSpreadsheetHeaders);
      assert.equal(sheet.views[0].state, 'frozen'); assert.equal(sheet.getCell('E2').dataValidation.type, 'list');
      assert.equal(sheet.getCell('M2').dataValidation.type, 'list'); assert(book.getWorksheet('Instructions'));
      assert.equal(typeof sheet.getCell('F1').note, 'string');
    }
  }
});
