const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { loadTypeScript, request } = require('./helpers/runtime.cjs');
const auth = { requireAuth: (_req, _res, next) => next() };

test('suggested check number respects both the configured starting number and live bills', async () => {
  let startingNumber = 5000;
  let lastNumber = 1001;
  const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', {
    '../db': { prisma: {
      property: { findUnique: async () => ({ nextCheckNumber: startingNumber }) },
      bill: { findFirst: async () => lastNumber === null ? null : { checkNumber: lastNumber } },
    } },
    '../middleware/auth': auth,
  });
  for (const [start, last, expected] of [[5000, 1001, 5000], [1001, 5000, 5001], [5000, null, 5000]]) {
    startingNumber = start; lastNumber = last;
    const result = await request(billsRouter, 'GET', '/next-check', { query: { propertyId: 'male' } });
    assert.equal(result.status, 200); assert.equal(result.body.nextCheckNumber, expected);
  }
});

test('bill filters reject invalid dates, reversed ranges and unsupported statuses before querying', async () => {
  const queries = [];
  const { billsRouter } = loadTypeScript('src/routes/bills.routes.ts', {
    '../db': { prisma: { bill: { findMany: async query => { queries.push(query); return []; } } } },
    '../middleware/auth': auth,
  });
  for (const query of [
    { startDate: '2026-02-30' }, { endDate: '2026-13-01' },
    { startDate: '2026-10-31', endDate: '2026-10-01' },
    { status: 'INVALID' }, { status: ['ACTIVE', 'DELETED'] }, { search: ['a', 'b'] },
  ]) assert.equal((await request(billsRouter, 'GET', '/', { query: { propertyId: 'male', ...query } })).status, 400);
  assert.equal(queries.length, 0);
  const valid = await request(billsRouter, 'GET', '/', { query: { propertyId: 'male', startDate: '2028-02-29', status: 'ALL' } });
  assert.equal(valid.status, 200);
  assert.equal(queries[0].where.businessDate.gte, '2028-02-29');
  assert.equal(queries[0].where.status, undefined);
});

function excelFixture() {
  const periods = [];
  const bill = { checkNumber: 1, roomNumber: '101', guestName: 'Guest', nationality: 'Other', items: [{}], grossAmount: 100, discountAmount: 10, serviceChargeAmount: 9, taxAmount: 11.88, tipAmount: 0, netAmount: 110.88 };
  const service = loadTypeScript('src/services/excelService.ts', {
    '../db': { prisma: {
      property: { findUnique: async () => ({ name: 'Test centre', currency: 'EUR' }) },
      bill: { findMany: async () => [bill] },
      attendance: { findMany: async () => [] },
    } },
    './commissionService': { calculateCommissionForPeriod: async (property, start, end) => { periods.push({ start, end }); return { staffResults: [], personalDetails: [] }; } },
  });
  return { service, periods };
}
async function readWorkbook(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
}
test('daily Excel reports include total discounts and property currency', async () => {
  const { service } = excelFixture();
  const workbook = await readWorkbook(await service.generateDailyExcelReport('male', '2026-10-29'));
  const sheet = workbook.getWorksheet('Bills');
  assert.equal(sheet.getCell('F1').value, 'Gross (EUR)');
  assert.equal(sheet.getCell('G3').value, '10.00');
  assert.equal(workbook.getWorksheet('Staff Commission').getCell('C1').value, 'Course Pool (EUR)');
});
test('monthly Excel uses real calendar month ends and avoids hard-coded tax rates and currency', async () => {
  const { service, periods } = excelFixture();
  for (const [month, end] of [['2026-02', '2026-02-28'], ['2028-02', '2028-02-29'], ['2026-04', '2026-04-30']]) {
    const workbook = await readWorkbook(await service.generateMonthlyExcelWorkbook('male', month));
    assert.deepEqual(periods.at(-1), { start: `${month}-01`, end });
    const overview = workbook.getWorksheet('Overview');
    const rows = overview.getSheetValues().filter(Boolean).map(row => row.slice(1));
    assert(rows.some(row => row[0] === 'Service Charge' && row[1] === 'EUR 9.00'));
    assert(rows.some(row => row[0] === 'Tax' && row[1] === 'EUR 11.88'));
    assert.equal(workbook.getWorksheet('Personal Commission Details').getCell('H1').value, 'Amount (EUR)');
  }
  await assert.rejects(service.generateMonthlyExcelWorkbook('male', '2026-13'), /valid month/);
});
