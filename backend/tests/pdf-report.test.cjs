const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const { renderReportPdf } = loadTypeScript('src/services/reportPdfRenderer.ts');
class GeneratedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-06T22:15:00.000Z'])); } }

function fixture(empty = false, propertyName = 'Siyam World') {
  const queries = [];
  let tables;
  let options;
  const staff = Array.from({ length: 12 }, (_, i) => ({ id: 'staff' + i, name: 'Employee ' + i, hireDate: '2020-01-01', leavingDate: null }));
  const bill = { checkNumber: 1001, roomNumber: '0012', guestName: 'Jürgen Иванов', businessDate: '2028-02-02', nationality: 'Other', grossAmount: 200, discountAmount: 40, serviceChargeAmount: 16, taxAmount: 28.16, tipAmount: 5, netAmount: 209.16,
    items: [{ categoryName: 'Retail', itemName: 'T-shirt', quantity: 2, lineTotal: 160 }] };
  const stubs = {
    '../db': { prisma: {
      property: { findUnique: async () => ({ id: 'sw', name: propertyName, currency: 'USD' }) },
      bill: { findMany: async query => { queries.push(query); return empty ? [] : [bill]; } },
      staffMember: { findMany: async () => empty ? [] : staff },
      attendance: { findMany: async () => empty ? [] : [{ staffMemberId: 'staff0', date: '2028-02-02', status: 'OFF_HALF' }] },
    } },
    './commissionService': { calculateCommissionForPeriod: async () => ({ grandTotal: empty ? 0 : 13, certificationPoolTotal: 0, storeAttendantPoolTotal: empty ? 0 : 8, unallocatedStoreAttendantPoolTotal: 0,
      staffResults: empty ? [] : [{ staffName: 'Store employee', roleTitle: 'Store Attendant', courseCommission: 0, diveCommission: 0, overrideCommission: 0, tipsCommission: 5, personalCommission: 8, totalCommission: 13 }],
      personalDetails: empty ? [] : [{ businessDate: bill.businessDate, checkNumber: bill.checkNumber, roomNumber: bill.roomNumber, guestName: bill.guestName, itemName: 'T-shirt', role: 'Store attendant (Retail 5% shared)', staffName: 'Store employee', amount: 8 }],
    }) },
    './reportPdfRenderer': { renderReportPdf: async (title, subtitle, sections, config) => { tables = sections; options = config; return renderReportPdf(title, subtitle, sections, config); } },
  };
  const service = loadTypeScript('src/services/pdfReportService.ts', stubs, { Date: GeneratedDate });
  return { ...service, queries, tables: () => tables, options: () => options };
}

test('monthly PDF preserves discounted financial totals, shared payments, full attendance month and room totals', async () => {
  const f = fixture();
  const buffer = await f.generateMonthlyPdfReport('sw', '2028-02', 'report.manager');
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.match(buffer.toString('latin1'), /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.deepEqual(f.options(), { signOff: true, preparedBy: { name: 'report.manager', date: '2026-11-07' } });
  const tables = f.tables();
  assert.deepEqual(tables.map(t => t.title), ['Overview', 'Item report', 'Commission and staff pay', 'Commission details', 'All bills', 'Attendance', 'Room report']);
  assert.equal(tables[0].rows.find(row => row[0] === 'Sales after discounts')[1], '160.00');
  assert.equal(tables[0].rows.find(row => row[0] === 'Staff commission excluding tips')[1], '8.00');
  assert.equal(tables[0].rows.find(row => row[0].startsWith('Store attendant'))[1], '8.00');
  assert.equal(tables[1].rows.at(-1).at(-1), '160.00');
  assert.equal(tables.at(-1).rows[0][0], '0012');
  assert.equal(tables.at(-1).rows.at(-1)[1], '160.00');
  const attendance = tables.find(table => table.title === 'Attendance');
  assert.equal(attendance.columns.length, 13);
  assert.equal(attendance.rows[1][1], 'O 1/2');
  assert.equal(attendance.rows[28][0], '2028-02-29');
  assert.equal(attendance.rows.find(row => row[0] === 'At work')[1], .5);
  assert.equal(attendance.rows.find(row => row[0] === 'Payable days')[1], 1);
  assert.deepEqual(f.queries[0].where, { propertyId: 'sw', status: 'ACTIVE', businessDate: { gte: '2028-02-01', lte: '2028-02-29' } });
  if (process.env.PDF_QA_DIR) fs.writeFileSync(process.env.PDF_QA_DIR + '/monthly-report.pdf', buffer);
});
test('daily and empty monthly reports produce valid PDFs with truthful zero totals', async () => {
  const daily = fixture();
  const pdf = await daily.generateDailyPdfReport('sw', '2028-02-02');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert(daily.tables().some(t => t.title === 'Daily bills'));
  assert(!daily.tables().some(t => t.title === 'Attendance'));
  assert.deepEqual(daily.options(), { signOff: false });
  assert.deepEqual(daily.queries[0].where.businessDate, { gte: '2028-02-02', lte: '2028-02-02' });
  const empty = fixture(true);
  const blank = await empty.generateMonthlyPdfReport('sw', '2028-02');
  assert.equal(blank.subarray(0, 5).toString(), '%PDF-');
  assert.equal(empty.tables()[0].rows.find(row => row[0] === 'Grand total')[1], '0.00');
  assert.equal(empty.tables().at(-1).rows[0][1], '0.00');
  if (process.env.PDF_QA_DIR) fs.writeFileSync(process.env.PDF_QA_DIR + '/daily-report.pdf', pdf);
});
test('the supplied letterhead applies only to Iru Fushi monthly reports; all monthly reports include sign-off', async () => {
  for (const name of ['Iru Fushi', 'Irufushi', 'Sun Siyam Iru Fushi']) {
    const f = fixture(false, name);
    const pdf = await f.generateMonthlyPdfReport('sw', '2028-02', 'iru.manager');
    assert.deepEqual(f.options(), { signOff: true, preparedBy: { name: 'iru.manager', date: '2026-11-07' }, letterhead: 'iru-fushi' });
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
    assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
    if (process.env.PDF_QA_DIR && name === 'Sun Siyam Iru Fushi') fs.writeFileSync(process.env.PDF_QA_DIR + '/irufushi-monthly-report.pdf', pdf);
    await f.generateDailyPdfReport('sw', '2028-02-02');
    assert.deepEqual(f.options(), { signOff: false });
  }
  for (const name of ['Siyam World', 'Sun Siyam Vilu Reef', 'Iru Fushi Annex']) {
    const f = fixture(true, name);
    const pdf = await f.generateMonthlyPdfReport('sw', '2028-02');
    assert.deepEqual(f.options(), { signOff: true, preparedBy: { name: 'System generated', date: '2026-11-07' } });
    assert.doesNotMatch(pdf.toString('latin1'), /\/Subtype \/Image/);
  }
});
test('sign-off fits on the last page or continues onto a new page when the final table fills it', async () => {
  const pdf = await renderReportPdf('Monthly report', '2028-02 | USD', [{ title: 'Room report', columns: [{ label: 'Room' }, { label: 'Turnover' }],
    rows: Array.from({ length: 16 }, (_, i) => [String(i), '100.00']) }], { signOff: true, preparedBy: { name: 'System generated', date: '2026-11-07' } });
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2);
  if (process.env.PDF_QA_DIR) fs.writeFileSync(process.env.PDF_QA_DIR + '/signoff-overflow.pdf', pdf);
});
test('long cells and large tables paginate without losing completion or crashing', async () => {
  const buffer = await renderReportPdf('Test report', 'USD', [{ title: 'Large table', columns: [{ label: 'Name', width: 120 }, { label: 'Description', width: 200 }],
    rows: Array.from({ length: 80 }, (_, index) => [String(index), index === 0 ? 'Long unbroken value'.repeat(600) : 'Repeated table row']) }]);
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert((buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 5);
});
test('export endpoints return PDF attachment headers and enforce property access and dates', async () => {
  const express = require('express');
  const router = express.Router();
  const generated = [];
  const { registerReportExportRoutes } = loadTypeScript('src/routes/report.export.ts', {
    '../middleware/auth': { requireAuth: (_req, _res, next) => next() },
    '../db': { prisma: { user: { findUnique: async ({ where }) => { assert.equal(where.id, 'current-user'); return { username: 'trusted.login' }; } } } },
    '../services/pdfReportService': { generateDailyPdfReport: async (...args) => { generated.push(args); return Buffer.from('%PDF-daily'); }, generateMonthlyPdfReport: async (...args) => { generated.push(args); return Buffer.from('%PDF-monthly'); } },
  });
  registerReportExportRoutes(router);
  const call = (path, query) => new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: 'GET', url: path, query, user: { id: 'current-user', name: 'Display name', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['sw'] } };
    const res = { statusCode: 200, setHeader: (key, value) => { headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body, headers }); }, send(body) { resolve({ status: this.statusCode, body, headers }); } };
    router.handle(req, res, reject);
  });
  for (const [path, query, filename] of [['/export/daily', { propertyId: 'sw', date: '2028-02-02' }, 'Daily_Report_2028-02-02.pdf'], ['/export/monthly', { propertyId: 'sw', yearMonth: '2028-02', preparedBy: 'forged.login' }, 'Monthly_Report_2028-02.pdf']]) {
    const response = await call(path, query);
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'application/pdf');
    assert.equal(response.headers['Content-Disposition'], `attachment; filename="${filename}"`);
    assert(Buffer.isBuffer(response.body));
  }
  assert.equal((await call('/export/daily', { propertyId: 'foreign', date: '2028-02-02' })).status, 403);
  assert.equal((await call('/export/monthly', { propertyId: 'sw', yearMonth: '2028-13' })).status, 400);
  assert.equal(generated.length, 2);
  assert.deepEqual(generated[1], ['sw', '2028-02', 'trusted.login']);
});
