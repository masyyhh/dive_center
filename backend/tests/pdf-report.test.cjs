const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const { renderReportPdf } = loadTypeScript('src/services/reportPdfRenderer.ts');
class GeneratedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-06T22:15:00.000Z'])); } }

function fixture(empty = false, propertyName = 'Siyam World', extraBills = [], commissionOverride) {
  const queries = [];
  let tables;
  let options;
  const staff = Array.from({ length: 12 }, (_, i) => ({ id: 'staff' + i, name: 'Employee ' + i, hireDate: '2020-01-01', leavingDate: null }));
  const bill = { checkNumber: 1001, roomNumber: '0012', guestName: 'Jürgen Иванов', businessDate: '2028-02-02', nationality: 'Other', grossAmount: 200, discountAmount: 40, serviceChargeAmount: 16, taxAmount: 28.16, tipAmount: 5, netAmount: 209.16,
    items: [{ categoryName: 'Retail', itemName: 'T-shirt', quantity: 2, lineTotal: 160 }] };
  const stubs = {
    '../db': { prisma: {
      property: { findUnique: async () => ({ id: 'sw', name: propertyName, currency: 'USD' }) },
      bill: { findMany: async query => { queries.push(query); return empty ? [] : [bill, ...extraBills]; } },
      staffMember: { findMany: async () => empty ? [] : staff },
      attendance: { findMany: async () => empty ? [] : [{ staffMemberId: 'staff0', date: '2028-02-02', status: 'OFF_HALF' }] },
    } },
    './commissionService': { calculateCommissionForPeriod: async () => (commissionOverride ?? { grandTotal: empty ? 0 : 13, certificationPoolTotal: 0, storeAttendantPoolTotal: empty ? 0 : 8, unallocatedStoreAttendantPoolTotal: 0,
      staffResults: empty ? [] : [{ staffId: 'store', staffName: 'Store employee', roleTitle: 'Store Attendant', courseCommission: 0, diveCommission: 0, overrideCommission: 0, tipsCommission: 5, personalCommission: 8, totalCommission: 13 }],
      personalDetails: empty ? [] : [{ businessDate: bill.businessDate, checkNumber: bill.checkNumber, roomNumber: bill.roomNumber, guestName: bill.guestName, itemName: 'T-shirt', role: 'Store attendant (Retail 5% shared)', staffId: 'store', staffName: 'Store employee', amount: 8 }],
    }) },
    './reportPdfRenderer': { renderReportPdf: async (title, subtitle, sections, config) => { tables = sections; options = config; return renderReportPdf(title, subtitle, sections, config); } },
  };
  const service = loadTypeScript('src/services/pdfReportService.ts', stubs, { Date: GeneratedDate });
  return { ...service, queries, tables: () => tables, options: () => options };
}

test('monthly PDF preserves discounted financial totals, shared payments, full attendance month and room totals', async () => {
  const f = fixture();
  const buffer = await f.generateMonthlyPdfReport('sw', '2028-02', 'Report Manager');
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.match(buffer.toString('latin1'), /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.deepEqual(f.options(), { signOff: true, preparedBy: { name: 'Report Manager', date: '2026-11-07' }, logo: 'dive-centre' });
  const tables = f.tables();
  assert.deepEqual(tables.map(t => t.title), ['Overview', 'Category summary', 'Item report', 'Staff payments', 'Personal commission summary', 'Commission details', 'Bill totals', 'Attendance', 'Room report']);
  assert.equal(tables[0].rows.find(row => row[0] === 'Sales after discounts')[1], '160.00');
  assert.equal(tables[0].rows.find(row => row[0] === 'Staff commission excluding tips')[1], '8.00');
  assert.equal(tables[0].rows.find(row => row[0].startsWith('Store attendant'))[1], '8.00');
  assert.equal(tables.find(table => table.title === 'Item report').rows.at(-1).at(-1), '160.00');
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
  assert.deepEqual(daily.tables().map(t => t.title), ['Bills', 'Staff Commission', 'Certifications Pool']);
  assert(!daily.tables().some(t => t.title === 'Attendance'));
  assert.deepEqual(daily.options(), { signOff: true, preparedBy: { name: 'System generated', date: '2026-11-07' }, logo: 'dive-centre' });
  assert.deepEqual(daily.queries[0].where.businessDate, { gte: '2028-02-02', lte: '2028-02-02' });
  const empty = fixture(true);
  const blank = await empty.generateMonthlyPdfReport('sw', '2028-02');
  assert.equal(blank.subarray(0, 5).toString(), '%PDF-');
  assert.equal(empty.tables()[0].rows.find(row => row[0] === 'Grand total')[1], '0.00');
  assert.equal(empty.tables().at(-1).rows[0][1], '0.00');
  if (process.env.PDF_QA_DIR) fs.writeFileSync(process.env.PDF_QA_DIR + '/daily-report.pdf', pdf);
});
test('compact financial tables keep complete bills and pay components together and reconcile category sales', async () => {
  const extra = { checkNumber: 1002, roomNumber: '0008', guestName: 'Second guest', businessDate: '2028-02-03', nationality: 'German', grossAmount: 300, discountAmount: 30, serviceChargeAmount: 27, taxAmount: 47.52, tipAmount: 10, netAmount: 354.52,
    items: [{ categoryName: 'Courses', itemName: 'Course', quantity: 3, lineTotal: 270 }] };
  for (const property of ['Siyam World', 'Sun Siyam Iru Fushi']) {
    const f = fixture(false, property, [extra]);
    const pdf = await f.generateMonthlyPdfReport('sw', '2028-02', 'Report Manager');
    if (process.env.PDF_QA_DIR && property === 'Sun Siyam Iru Fushi') fs.writeFileSync(process.env.PDF_QA_DIR + '/irufushi-multiple-bills.pdf', pdf);
    const get = title => f.tables().find(table => table.title === title);
    for (const title of ['Category summary', 'Item report', 'Staff payments', 'Personal commission summary', 'Commission details', 'Bill totals']) assert.equal(get(title).singleTable, true);
    assert.deepEqual(get('Category summary').rows, [['Courses', 3, '270.00'], ['Retail', 2, '160.00'], ['TOTAL', 5, '430.00']]);
    const pay = get('Staff payments');
    assert.equal(pay.columns.length, 3);
    assert.match(pay.rows[0][0], /Store employee\nStore Attendant/);
    assert.equal(pay.rows[0][1], 'Personal: 8.00');
    assert.equal(pay.rows.at(-1)[2], '13.00\nTips: 5.00');
    const totals = get('Bill totals');
    assert.equal(totals.columns.length, 4);
    assert.match(totals.rows[0][0], /#1001\nJürgen Иванов\nRoom: 0012/);
    assert.match(totals.rows[1][0], /Room: 0008\nDate: 2028-02-03\nNationality: German\nItems: 1/);
    assert.equal(totals.rows.at(-1)[1], '430.00\nGross: 500.00\nDiscount: 70.00');
    assert.equal(totals.rows.at(-1)[2], 'Service: 43.00\nTax: 75.68\nTip: 15.00');
    assert.equal(totals.rows.at(-1)[3], '563.68');
  }
});
test('Iru Fushi keeps its monthly letterhead and daily logo, with sign-off on both reports', async () => {
  for (const name of ['Iru Fushi', 'Irufushi', 'Sun Siyam Iru Fushi']) {
    const f = fixture(false, name);
    const pdf = await f.generateMonthlyPdfReport('sw', '2028-02', 'Iru Fushi Manager');
    assert.deepEqual(f.options(), { signOff: true, preparedBy: { name: 'Iru Fushi Manager', date: '2026-11-07' }, letterhead: 'iru-fushi' });
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
    assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
    if (process.env.PDF_QA_DIR && name === 'Sun Siyam Iru Fushi') fs.writeFileSync(process.env.PDF_QA_DIR + '/irufushi-monthly-report.pdf', pdf);
    const daily = await f.generateDailyPdfReport('sw', '2028-02-02');
    assert.deepEqual(f.options(), { signOff: true, preparedBy: { name: 'System generated', date: '2026-11-07' }, logo: 'iru-fushi' });
    assert.match(daily.toString('latin1'), /\/MediaBox \[0 0 841\.89 595\.28\]/);
    assert.match(daily.toString('latin1'), /\/Subtype \/Image/);
    if (process.env.PDF_QA_DIR && name === 'Sun Siyam Iru Fushi') fs.writeFileSync(process.env.PDF_QA_DIR + '/irufushi-daily-report.pdf', daily);
  }
  for (const name of ['Siyam World', 'Sun Siyam Vilu Reef', 'Iru Fushi Annex']) {
    const f = fixture(true, name);
    const pdf = await f.generateMonthlyPdfReport('sw', '2028-02');
    assert.deepEqual(f.options(), { signOff: true, preparedBy: { name: 'System generated', date: '2026-11-07' }, logo: 'dive-centre' });
    assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
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
  let accountExists = true;
  const { registerReportExportRoutes } = loadTypeScript('src/routes/report.export.ts', {
    '../middleware/auth': { requireAuth: (_req, _res, next) => next() },
    '../db': { prisma: { user: { findUnique: async ({ where, select }) => { assert.equal(where.id, 'current-user'); assert.deepEqual(select, { name: true }); return accountExists ? { name: 'Trusted Full Name', username: 'trusted.login' } : null; } } } },
    '../services/pdfReportService': { generateDailyPdfReport: async (...args) => { generated.push(args); return Buffer.from('%PDF-daily'); }, generateMonthlyPdfReport: async (...args) => { generated.push(args); return Buffer.from('%PDF-monthly'); } },
  });
  registerReportExportRoutes(router);
  const call = (path, query) => new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: 'GET', url: path, query, user: { id: 'current-user', name: 'Display name', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['sw'] } };
    const res = { statusCode: 200, setHeader: (key, value) => { headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body, headers }); }, send(body) { resolve({ status: this.statusCode, body, headers }); } };
    router.handle(req, res, reject);
  });
  for (const [path, query, filename] of [['/export/daily', { propertyId: 'sw', date: '2028-02-02', preparedBy: 'forged.login' }, 'Daily_Report_2028-02-02.pdf'], ['/export/monthly', { propertyId: 'sw', yearMonth: '2028-02', preparedBy: 'forged.login' }, 'Monthly_Report_2028-02.pdf']]) {
    const response = await call(path, query);
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'application/pdf');
    assert.equal(response.headers['Content-Disposition'], `attachment; filename="${filename}"`);
    assert(Buffer.isBuffer(response.body));
  }
  assert.equal((await call('/export/daily', { propertyId: 'foreign', date: '2028-02-02' })).status, 403);
  assert.equal((await call('/export/monthly', { propertyId: 'sw', yearMonth: '2028-13' })).status, 400);
  assert.equal(generated.length, 2);
  assert.deepEqual(generated[0], ['sw', '2028-02-02', 'Trusted Full Name']);
  assert.deepEqual(generated[1], ['sw', '2028-02', 'Trusted Full Name']);
  accountExists = false;
  assert.equal((await call('/export/daily', { propertyId: 'sw', date: '2028-02-02' })).status, 401);
  assert.equal((await call('/export/monthly', { propertyId: 'sw', yearMonth: '2028-02' })).status, 401);
  assert.equal(generated.length, 2);
});


test('daily finance PDF keeps reference columns and correct line counts, totals and authenticated preparer', async () => {
  const f = fixture();
  await f.generateDailyPdfReport('sw', '2028-02-02', 'Finance Full Name');
  const [bills, staff, certifications] = f.tables();
  assert.equal(bills.columns.length, 11);
  assert.deepEqual(bills.rows[0], [1001, '0012', 'Jürgen Иванов', 'Other', 1, '200.00', '40.00', '16.00', '28.16', '5.00', '209.16']);
  assert.equal(bills.rows.at(-1)[4], 1);
  assert.equal(bills.rows.at(-1).at(-1), '209.16');
  assert.equal(staff.columns.length, 8);
  assert.equal(staff.rows.at(-1).at(-1), '13.00');
  assert.equal(certifications.rows[1][1], 'No staff commission or base-leader override');
  assert.equal(f.options().preparedBy.name, 'Finance Full Name');
  assert(bills.singleTable && staff.singleTable);
});

test('monthly photo, upselling and guiding splits preserve all saved personal payments without double counting', async () => {
  const roles = [['Photo', 10.005], ['Photo / Video', 5], ['Seller', 7.005], ['Guide', 9.005], ['Instructor', 3], ['Video', 2], ['Store attendant (Retail 5% shared)', 4]];
  const personal = Math.round(roles.reduce((total, [, amount]) => total + amount, 0) * 100) / 100;
  const f = fixture(false, 'Iru Fushi', [], {
    grandTotal: personal + 6, certificationPoolTotal: 0, storeAttendantPoolTotal: 4, unallocatedStoreAttendantPoolTotal: 0,
    staffResults: [{ staffId: 'same', staffName: 'Same employee', roleTitle: 'Instructor', courseCommission: 1, diveCommission: 1, overrideCommission: 1, tipsCommission: 3, personalCommission: personal, totalCommission: personal + 6 }],
    personalDetails: roles.map(([role, amount]) => ({ staffId: 'same', staffName: 'Same employee', role, amount })),
  });
  await f.generateMonthlyPdfReport('sw', '2028-02');
  const table = f.tables().find(t => t.title === 'Personal commission summary');
  assert.deepEqual(table.rows[0].slice(1, 4), ['15.01', '7.01', '9.01']);
  const row = table.rows[0];
  assert.equal(row.slice(1, 5).reduce((total, value) => total + Math.round(Number(value) * 100), 0), Math.round(personal * 100));
  assert.equal(row.at(-1), personal.toFixed(2));
  assert.deepEqual(table.rows.at(-1).slice(1), row.slice(1));
  assert.equal(f.tables().find(t => t.title === 'Staff payments').rows[0][2], `${(personal + 6).toFixed(2)}\nTips: 3.00`);
});
