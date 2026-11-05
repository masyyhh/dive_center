import ExcelJS from 'exceljs';
import type { Attendance, Bill, BillItem, Property, StaffMember } from '@prisma/client';
import type { PersonalCommissionDetail, StaffCommissionResult } from './commissionService';
import { createReportWorkbook } from './reportWorkbook';

interface MonthlyData {
  property: Property;
  yearMonth: string;
  bills: (Bill & { items: BillItem[] })[];
  staff: StaffMember[];
  attendances: Attendance[];
  staffResults: StaffCommissionResult[];
  personalDetails: PersonalCommissionDetail[];
  certificationPoolTotal: number;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const round = (value: number) => Math.round(value * 100) / 100;
const codes: Record<string, string> = { PRESENT: 'p', OFF: 'o', OFF_HALF: 'o1/2', ANNUAL_LEAVE: 'al', SICK: 's', ABSENT: 'a', EMERGENCY_LEAVE: 'el' };

/** Printable ledger layout. All amounts come from saved bills and existing payroll rules. */
export function createSiyamMonthlyWorkbook(data: MonthlyData) {
  const { property, yearMonth, bills, staff, attendances, staffResults, personalDetails, certificationPoolTotal } = data;
  const workbook = createReportWorkbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const money = `"${property.currency.replace(/"/g, '')}" #,##0.00;("${property.currency.replace(/"/g, '')}" #,##0.00);"-"`;
  const sheet = (name: string, headers: string[], widths: number[]) => {
    const ws = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 4, xSplit: name === 'Attendance' ? 1 : 0, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: headers.length > 5 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:4' },
    });
    widths.forEach((width, index) => { ws.getColumn(index + 1).width = width; });
    ws.mergeCells(1, 1, 1, headers.length);
    ws.getCell(1, 1).value = `Diving - ${property.name} - Monthly Report - ${yearMonth} - ${name}`;
    ws.getRow(1).font = { name: 'Arial', size: 14, bold: true };
    ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    const totalWidth = sum(widths);
    ws.getRow(1).height = totalWidth < 55 ? 80 : 38;
    ws.mergeCells(2, 1, 2, headers.length);
    ws.getCell(2, 1).value = `Currency: ${property.currency} | Active bills only | Sales exclude service charge, tax and tips`;
    ws.getRow(2).height = totalWidth < 55 ? 60 : 28;
    ws.getRow(2).alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(4).values = headers;
    heading(ws.getRow(4));
    return ws;
  };
  function heading(row: ExcelJS.Row) {
    row.font = { name: 'Arial', bold: true, size: 10 };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = 30;
    row.eachCell(cell => { cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } }; });
  }
  function amountRow(ws: ExcelJS.Worksheet, values: ExcelJS.CellValue[], from: number, total = false) {
    const row = ws.addRow(values);
    for (let col = from; col <= values.length; col++) row.getCell(col).numFmt = money;
    if (total) heading(row);
    return row;
  }
  function totals(ws: ExcelJS.Worksheet, from: number, end: number) {
    const last = ws.rowCount;
    const row = ws.addRow(['Total']);
    for (let col = from; col <= end; col++) {
      const letter = ws.getColumn(col).letter;
      const result = sum(Array.from({ length: Math.max(0, last - 4) }, (_, i) => Number(ws.getCell(i + 5, col).value) || 0));
      row.getCell(col).value = last >= 5 ? { formula: `SUM(${letter}5:${letter}${last})`, result: round(result) } : 0;
      row.getCell(col).numFmt = money;
    }
    heading(row);
    return row;
  }

  // The six reference panels are six editable worksheets, rather than embedded pictures.
  const overview = sheet('Overview', ['', '', '', '', ''], [27, 23, 22, 12, 22]);
  // The supplied CSV defines the Overview's five-column, 21-row form.
  // Preserve its section spacing, but populate saved totals instead of sample values/errors.
  overview.getCell('A2').value = null;
  overview.getRow(2).height = 12;
  overview.views = [{ showGridLines: false }];
  overview.pageSetup.printTitlesRow = '1:1';
  for (const range of ['A3:E3', 'A4:C4', 'A5:D5', 'A7:D7', 'A9:E9', 'A10:D10', 'A12:D12', 'A14:E14', 'A15:D15', 'A17:D17', 'A20:E20', 'A21:C21', 'A23:E23']) overview.mergeCells(range);
  const sales = sum(bills.map(b => b.grossAmount - b.discountAmount));
  overview.getCell('A3').value = 'Turnover:';
  overview.getCell('A4').value = `Free snorkel gear (according to ${property.currency} 1.50)`;
  overview.getCell('D4').value = null;
  overview.getCell('D4').dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: 'Invalid quantity', error: 'Enter a whole number of units, zero or greater.' };
  overview.getCell('D4').numFmt = '0';
  overview.getCell('D4').note = 'Enter the monthly quantity manually; enter 0 if none. This adjustment is not recorded on bills.';
  overview.getCell('E4').value = { formula: 'IF(D4="","",ROUND(D4*1.5,2))', result: '' };
  overview.getCell('A5').value = 'Total sales (chargeable items)';
  overview.getCell('E5').value = round(sales);
  overview.getCell('A7').value = 'Total turnover (excluding taxes and service charge):';
  overview.getCell('E7').value = { formula: 'IF(D4="","",SUM(E4:E5))', result: '' };
  overview.getCell('A9').value = 'Service charge:';
  overview.getCell('A10').value = 'Resort service charge';
  overview.getCell('E10').value = round(sum(bills.map(b => b.serviceChargeAmount)));
  overview.getCell('A12').value = 'Total service charge:';
  overview.getCell('E12').value = { formula: 'E10', result: round(sum(bills.map(b => b.serviceChargeAmount))) };
  overview.getCell('A14').value = 'Commission:';
  overview.getCell('A15').value = 'Course, Dive, Overriding, Personal';
  overview.getCell('E15').value = round(sum(staffResults.map(s => s.totalCommission - s.tipsCommission)));
  overview.getCell('E15').note = 'Existing course, dive, base-leader override and personal commission totals. Tips are separate; no additional GM, tank or night commission rules are introduced.';
  overview.getCell('A17').value = 'Total commission:';
  overview.getCell('E17').value = { formula: 'E15', result: round(sum(staffResults.map(s => s.totalCommission - s.tipsCommission))) };
  overview.getCell('A20').value = 'Prepared by';
  overview.getCell('A21').value = null;
  overview.getCell('A21').note = 'Enter the report preparer’s name.';
  for (const address of ['D4', 'A21']) overview.getCell(address).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };
  for (const row of [3, 7, 9, 12, 14, 17, 20]) heading(overview.getRow(row));
  for (const row of [4, 5, 10, 15, 21]) overview.getRow(row).height = 28;
  for (const row of [4, 5, 7, 10, 12, 15, 17]) overview.getCell(row, 5).numFmt = money;
  overview.getCell('A23').value = `Enter the free snorkel gear quantity in the yellow cell (0 if none) to calculate total turnover. The ${property.currency} 1.50 per-unit adjustment is additional to billed sales. Commission excludes tips.`;
  overview.getRow(23).height = 42;

  // Retain supporting figures below the supplied overview form.
  heading(overview.getRow(25));
  overview.mergeCells('A25:E25');
  overview.getCell('A25').value = 'Supporting totals';
  const supportingTotals: [string, number][] = [
    ['Gross sales before discounts', sum(bills.map(b => b.grossAmount))],
    ['Discounts', sum(bills.map(b => b.discountAmount))],
    ['Taxes', sum(bills.map(b => b.taxAmount))],
    ['Tips collected', sum(bills.map(b => b.tipAmount))],
    ['Total bill amount', sum(bills.map(b => b.netAmount))],
    ['Tips payable to staff', sum(staffResults.map(s => s.tipsCommission))],
    ['Total staff pay', sum(staffResults.map(s => s.totalCommission))],
    ['Certifications pool (not paid to staff)', certificationPoolTotal],
    ['Total active bills', bills.length],
  ];
  supportingTotals.forEach(([label, value], index) => {
    const row = index + 26;
    overview.mergeCells(row, 1, row, 4);
    overview.getCell(row, 1).value = label;
    overview.getCell(row, 5).value = round(value);
    overview.getCell(row, 5).numFmt = label === 'Total active bills' ? '0' : money;
    overview.getRow(row).height = 24;
  });

  const attendanceStaff = new Map(staff.filter(s => s.isDiveStaff).map(s => [s.id, s]));
  // Retain historical recorded staff even if their current employment dates changed.
  for (const record of attendances as (Attendance & { staffMember?: StaffMember })[]) {
    if (record.staffMember?.isDiveStaff) attendanceStaff.set(record.staffMember.id, record.staffMember);
  }
  const people = [...attendanceStaff.values()].sort((a, b) => a.name.localeCompare(b.name));
  const attendance = sheet('Attendance', ['Date', ...people.map(s => s.name), ...(!people.length ? ['No staff'] : [])], [16, ...Array(Math.max(1, people.length)).fill(9)]);
  attendance.getRow(4).height = 130;
  people.forEach((_, index) => { attendance.getCell(4, index + 2).alignment = { textRotation: 90, vertical: 'middle', horizontal: 'center', wrapText: true }; });
  const days = new Date(`${yearMonth}-01T12:00:00Z`);
  days.setUTCMonth(days.getUTCMonth() + 1, 0);
  const statuses = new Map(attendances.map(a => [`${a.staffMemberId}:${a.date}`, a.status]));
  for (let day = 1; day <= days.getUTCDate(); day++) {
    const date = `${yearMonth}-${String(day).padStart(2, '0')}`;
    const row = attendance.addRow([new Date(`${date}T12:00:00Z`), ...people.map(s => codes[statuses.get(`${s.id}:${date}`) || ''] || '')]);
    row.getCell(1).numFmt = 'dd/mm/yyyy';
    row.eachCell((cell, col) => { if (col > 1) cell.alignment = { horizontal: 'center' }; });
  }
  attendance.addRow([]);
  const count = (id: string, status: string) => attendances.filter(a => a.staffMemberId === id && a.status === status).length;
  const summary: [string, (id: string) => number][] = [
    ['At work', id => count(id, 'PRESENT') + count(id, 'OFF_HALF') / 2],
    ['Off', id => count(id, 'OFF') + count(id, 'OFF_HALF') / 2],
    ['Annual leave', id => count(id, 'ANNUAL_LEAVE')],
    ['Sick', id => count(id, 'SICK')],
    ['Absent', id => count(id, 'ABSENT')],
    ['Emergency leave', id => count(id, 'EMERGENCY_LEAVE')],
    ['Not recorded', id => days.getUTCDate() - attendances.filter(a => a.staffMemberId === id).length],
    ['Pool-eligible days', id => count(id, 'PRESENT') + count(id, 'OFF') + count(id, 'OFF_HALF')],
  ];
  for (const [label, value] of summary) attendance.addRow([label, ...people.map(s => value(s.id))]).height = 30;
  attendance.addRow([]);
  attendance.addRow(['Codes: p = present; o = off; o1/2 = half-day off; al = annual leave; s = sick; a = absent; el = emergency leave.']);
  attendance.mergeCells(attendance.rowCount, 1, attendance.rowCount, Math.max(2, people.length + 1));
  attendance.lastRow!.height = 42;
  attendance.lastRow!.alignment = { wrapText: true };
  attendance.addRow(['Blank = not recorded. Pool-eligible days include present, off and half-day off; leave and absence are excluded.']);
  attendance.mergeCells(attendance.rowCount, 1, attendance.rowCount, Math.max(2, people.length + 1));
  attendance.lastRow!.height = 42;
  attendance.lastRow!.alignment = { wrapText: true };

  const roomSheet = sheet('Room report', ['Room', 'Turnover'], [20, 26]);
  const rooms = new Map<string, number>();
  for (const bill of bills) rooms.set(bill.roomNumber, (rooms.get(bill.roomNumber) || 0) + bill.grossAmount - bill.discountAmount);
  for (const [room, value] of [...rooms].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) amountRow(roomSheet, [room, round(value)], 2);
  totals(roomSheet, 2, 2);

  const categories = [...new Set(bills.flatMap(b => b.items.map(i => i.categoryName || 'Other')))].sort();
  const billSheet = sheet('All bills', ['Check', 'Room', 'Name', ...categories, 'Total', 'SC', 'Taxes', 'Tips', 'Sum'], [14, 12, 28, ...categories.map(() => 16), 18, 16, 16, 16, 18]);
  for (const bill of bills) amountRow(billSheet, [bill.checkNumber, bill.roomNumber, bill.guestName,
    ...categories.map(category => round(sum(bill.items.filter(i => (i.categoryName || 'Other') === category).map(i => i.lineTotal)))),
    round(bill.grossAmount - bill.discountAmount), bill.serviceChargeAmount, bill.taxAmount, bill.tipAmount, bill.netAmount], 4);
  totals(billSheet, 4, categories.length + 8);
  if (bills.length) billSheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: bills.length + 4, column: categories.length + 8 } };

  const itemSheet = sheet('Item report', ['Main category', 'Category subtotal', 'Item', 'Count', 'Turnover'], [24, 22, 42, 12, 20]);
  const groups = new Map<string, Map<string, { count: number; turnover: number }>>();
  for (const bill of bills) for (const item of bill.items) {
    const category = item.categoryName || 'Other';
    const group = groups.get(category) || new Map();
    const aggregate = group.get(item.itemName) || { count: 0, turnover: 0 };
    aggregate.count += item.quantity;
    aggregate.turnover += item.lineTotal;
    group.set(item.itemName, aggregate);
    groups.set(category, group);
  }
  for (const category of categories) {
    const items = [...groups.get(category)!].sort(([a], [b]) => a.localeCompare(b));
    const first = itemSheet.rowCount + 1;
    items.forEach(([name, value], index) => {
      const row = amountRow(itemSheet, [index ? null : category, index ? null : round(sum(items.map(([, v]) => v.turnover))), name, value.count, round(value.turnover)], 5);
      row.getCell(2).numFmt = money;
      row.getCell(4).numFmt = '0';
    });
    if (items.length > 1) { itemSheet.mergeCells(first, 1, itemSheet.rowCount, 1); itemSheet.mergeCells(first, 2, itemSheet.rowCount, 2); }
  }
  const itemTotal = totals(itemSheet, 4, 5);
  itemTotal.getCell(4).numFmt = '0';
  itemTotal.getCell(2).value = round(sum(bills.flatMap(b => b.items.map(i => i.lineTotal))));
  itemTotal.getCell(2).numFmt = money;

  const commission = sheet('Commission, SC', ['Staff member', 'Role', 'Course', 'Dive', 'Override', 'Personal', 'Tips', 'Total'], [28, 24, 16, 16, 16, 16, 16, 18]);
  for (const person of staffResults) amountRow(commission, [person.staffName, person.roleTitle, person.courseCommission, person.diveCommission, person.overrideCommission, person.personalCommission, person.tipsCommission, person.totalCommission], 3);
  totals(commission, 3, 8);
  commission.addRow([]);
  const scRow = amountRow(commission, ['Resort service charge collected', null, sum(bills.map(b => b.serviceChargeAmount))], 3, true);
  commission.mergeCells(scRow.number, 1, scRow.number, 2);
  const certRow = amountRow(commission, ['Certifications pool (not paid to staff)', null, certificationPoolTotal], 3);
  commission.mergeCells(certRow.number, 1, certRow.number, 2);
  certRow.height = 30;
  commission.addRow([]);
  heading(commission.addRow(['Personal commission details']));
  heading(commission.addRow(['Date', 'Check', 'Room', 'Guest', 'Item / activity', 'Role', 'Staff member', 'Amount']));
  for (const detail of personalDetails) amountRow(commission, [detail.businessDate, detail.checkNumber, detail.roomNumber, detail.guestName, detail.itemName, detail.role, detail.staffName, detail.amount], 8).height = 48;

  for (const ws of workbook.worksheets) {
    ws.eachRow(row => row.eachCell(cell => {
      cell.font = { name: 'Arial', size: 10, ...cell.font };
      cell.border = { top: { style: 'hair', color: { argb: 'FFAAAAAA' } }, bottom: { style: 'hair', color: { argb: 'FFAAAAAA' } }, left: { style: 'hair', color: { argb: 'FFAAAAAA' } }, right: { style: 'hair', color: { argb: 'FFAAAAAA' } }, ...cell.border };
      cell.alignment = { vertical: 'middle', wrapText: true, ...cell.alignment };
    }));
    ws.pageSetup.printArea = `A1:${ws.getColumn(ws.columnCount).letter}${ws.rowCount}`;
    ws.headerFooter.oddFooter = '&L' + property.name + ' | ' + yearMonth + '&RPage &P of &N';
  }
  return workbook;
}
