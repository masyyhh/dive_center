const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { loadTypeScript } = require('./helpers/runtime.cjs');

function fixture(name = 'Siyam World', empty = false) {
  const queries = [];
  const staff = [{ id: 'instructor', name: 'Instructor', roleTitle: 'Instructor', isDiveStaff: true, hireDate: '2020-01-01' }, { id: 'unmarked', name: 'Unmarked staff', roleTitle: 'Divemaster', isDiveStaff: true, hireDate: '2020-01-01' }];
  const bills = empty ? [] : [
    { checkNumber: 101, roomNumber: '201', guestName: 'First guest', grossAmount: 200, discountAmount: 20, serviceChargeAmount: 18, taxAmount: 31.68, tipAmount: 5, netAmount: 234.68,
      items: [{ itemName: 'Discover Scuba', categoryName: 'Courses', quantity: 2, lineTotal: 135 }, { itemName: 'Photo', categoryName: 'Photo & Video', quantity: 1, lineTotal: 45 }] },
    { checkNumber: 102, roomNumber: '201', guestName: 'Second guest', grossAmount: 50, discountAmount: 5, serviceChargeAmount: 4.5, taxAmount: 7.92, tipAmount: 0, netAmount: 57.42,
      items: [{ itemName: 'Discover Scuba', categoryName: 'Courses', quantity: 1, lineTotal: 45 }] },
    { checkNumber: 103, roomNumber: '102', guestName: 'Third guest', grossAmount: 25, discountAmount: 0, serviceChargeAmount: 2.5, taxAmount: 4.4, tipAmount: 0, netAmount: 31.9,
      items: [{ itemName: 'Single Dive', categoryName: 'Dives', quantity: 1, lineTotal: 25 }] },
  ];
  const { generateMonthlyExcelWorkbook } = loadTypeScript('src/services/monthlyExcelWorkbook.ts', {
    '../db': { prisma: {
      property: { findUnique: async () => ({ id: 'sw', name, currency: 'USD' }) },
      bill: { findMany: async query => { queries.push(['bills', query]); return bills; } },
      attendance: { findMany: async () => empty ? [] : ['PRESENT', 'OFF_HALF', 'OFF', 'SICK', 'ANNUAL_LEAVE', 'ABSENT', 'EMERGENCY_LEAVE'].map((status, index) => ({ staffMemberId: staff[0].id, staffMember: staff[0], date: `2028-02-0${index + 1}`, status })) },
      staffMember: { findMany: async query => { queries.push(['staff', query]); return empty ? [] : staff; } },
    } },
    './commissionService': { calculateCommissionForPeriod: async () => ({
      staffResults: empty ? [] : [{ staffId: 'instructor', staffName: 'Instructor', roleTitle: 'Instructor', courseCommission: 12, diveCommission: 3, overrideCommission: 1.5, personalCommission: 4, tipsCommission: 5, totalCommission: 25.5 }],
      personalDetails: empty ? [] : [{ businessDate: '2028-02-01', checkNumber: 101, roomNumber: '201', guestName: 'First guest', itemName: 'Photo', role: 'Photo', staffName: 'Instructor', amount: 4 }],
      certificationPoolTotal: 7,
    }) },
  });
  return { generate: async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateMonthlyExcelWorkbook('sw', '2028-02'));
    return workbook;
  }, queries };
}
function rowNamed(sheet, label) {
  let found;
  sheet.eachRow(row => { if (row.getCell(1).value === label) found = row; });
  assert.ok(found, `Expected row ${label}`);
  return found;
}

test('Siyam monthly workbook separates the six reference panels and reconciles discounted sales', async () => {
  const { generate, queries } = fixture();
  const workbook = await generate();
  assert.deepEqual(workbook.worksheets.map(s => s.name), ['Overview', 'Attendance', 'Room report', 'All bills', 'Item report', 'Commission, SC']);
  const overview = workbook.getWorksheet('Overview');
  assert.equal(overview.getCell('E5').value, 250);
  assert.equal(rowNamed(overview, 'Total bill amount').getCell(5).value, 324);
  assert.equal(rowNamed(overview, 'Total staff pay').getCell(5).value, 25.5);
  assert.equal(overview.getCell('E15').value, 20.5);
  const rooms = workbook.getWorksheet('Room report');
  assert.equal(rooms.getCell('A5').value, '102');
  assert.equal(rooms.getCell('B6').value, 225);
  assert.equal(rooms.getCell('B7').value.result, 250);
  const bills = workbook.getWorksheet('All bills');
  assert.deepEqual(bills.getRow(4).values.slice(1), ['Check', 'Room', 'Name', 'Courses', 'Dives', 'Photo & Video', 'Total', 'SC', 'Taxes', 'Tips', 'Sum']);
  assert.equal(bills.getCell('D5').value, 135);
  assert.equal(bills.getCell('G8').value.result, 250);
  assert.equal(bills.getCell('K8').value.result, 324);
  const items = workbook.getWorksheet('Item report');
  assert.equal(items.getCell('C5').value, 'Discover Scuba');
  assert.equal(items.getCell('D5').value, 3);
  assert.equal(items.getCell('E5').value, 180);
  assert.equal(items.lastRow.getCell(4).value.result, 5);
  assert.equal(items.lastRow.getCell(5).value.result, 250);
  const commission = workbook.getWorksheet('Commission, SC');
  assert.equal(rowNamed(commission, 'Total').getCell(8).value.result, 25.5);
  assert.equal(rowNamed(commission, 'Resort service charge collected').getCell(3).value, 25);
  assert.equal(rowNamed(commission, 'Certifications pool (not paid to staff)').getCell(3).value, 7);
  assert.equal(commission.lastRow.getCell(8).value, 4);
  assert.equal(queries[0][1].where.status, 'ACTIVE');
  assert.deepEqual(queries[0][1].where.businessDate, { gte: '2028-02-01', lte: '2028-02-29' });
  for (const sheet of workbook.worksheets) {
    assert.match(sheet.getCell('A1').value, /Siyam World - Monthly Report - 2028-02/);
    assert.equal(sheet.pageSetup.fitToWidth, 1);
    assert.equal(sheet.pageSetup.fitToHeight, 0);
    assert.ok(sheet.pageSetup.printArea);
  }
});

test('Siyam Overview follows the CSV form with editable inputs and calculated totals', async () => {
  const overview = (await fixture().generate()).getWorksheet('Overview');
  for (const [cell, label] of Object.entries({ A3: 'Turnover:', A5: 'Total sales (chargeable items)', A7: 'Total turnover (excluding taxes and service charge):', A9: 'Service charge:', A10: 'Resort service charge', A12: 'Total service charge:', A14: 'Commission:', A17: 'Total commission:', A20: 'Prepared by' })) assert.equal(overview.getCell(cell).value, label);
  assert.equal(overview.getCell('D4').value, null);
  assert.equal(overview.getCell('A21').value, null);
  assert.match(overview.getCell('E4').formula, /D4\*1\.5/);
  assert.equal(overview.getCell('E7').formula, 'IF(D4="","",SUM(E4:E5))');
  assert.equal(overview.getCell('E12').value.result, 25);
  assert.equal(overview.getCell('E17').value.result, 20.5);
  assert.equal(overview.getCell('D4').dataValidation.type, 'whole');
  assert.equal(overview.getCell('D4').fill.fgColor.argb, 'FFFFFF99');
  overview.eachRow(row => row.eachCell(cell => assert.ok(!['#VALUE!', '?', 'Danijela Podlipec'].includes(cell.value))));
});

test('attendance matrix includes every calendar day and unmarked staff without inventing attendance', async () => {
  const workbook = await fixture().generate();
  const attendance = workbook.getWorksheet('Attendance');
  assert.equal(attendance.getCell('B4').value, 'Instructor');
  assert.equal(attendance.getCell('C4').value, 'Unmarked staff');
  assert.equal(attendance.getCell('B6').value, 'o1/2');
  assert.equal(attendance.getCell('A33').value.toISOString().slice(0, 10), '2028-02-29');
  assert.equal(rowNamed(attendance, 'At work').getCell(2).value, 1.5);
  assert.equal(rowNamed(attendance, 'Off').getCell(2).value, 1.5);
  assert.equal(rowNamed(attendance, 'Pool-eligible days').getCell(2).value, 3);
  assert.equal(rowNamed(attendance, 'Not recorded').getCell(2).value, 22);
  assert.equal(rowNamed(attendance, 'Not recorded').getCell(3).value, 29);
});

test('empty Siyam monthly reports have six valid sheets and zero totals', async () => {
  const workbook = await fixture('Sun Siyam World', true).generate();
  assert.equal(workbook.worksheets.length, 6);
  for (const name of ['Room report', 'All bills', 'Item report', 'Commission, SC']) {
    const row = rowNamed(workbook.getWorksheet(name), 'Total');
    row.eachCell((cell, column) => { if (column > 1) assert.equal(cell.value, 0); });
  }
});

test('other Sun Siyam properties retain the existing four-sheet monthly report', async () => {
  for (const name of ['Sun Siyam Iru Fushi', 'Sun Siyam Vilu Reef']) {
    const { generate, queries } = fixture(name, true);
    const workbook = await generate();
    assert.deepEqual(workbook.worksheets.map(s => s.name), ['Overview', 'Staff Commission Breakdown', 'Personal Commission Details', 'Attendance Register']);
    assert.equal(queries.filter(([type]) => type === 'staff').length, 0);
  }
});
