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
  unallocatedStoreAttendantPoolTotal?: number;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const round = (value: number) => Math.round(value * 100) / 100;
const codes: Record<string, string> = {
  PRESENT: 'p',
  OFF: 'o',
  OFF_HALF: 'o1/2',
  ANNUAL_LEAVE: 'al',
  SICK: 's',
  ABSENT: 'a',
  EMERGENCY_LEAVE: 'el',
};

const getSubCategory = (mainCat: string) => {
  if (/^course/i.test(mainCat)) return 'Beginner Courses';
  if (/^retail/i.test(mainCat)) return 'Regular Retail';
  return mainCat;
};

/** Printable ledger layout matching Siyam World monthly report sample. */
export function createSiyamMonthlyWorkbook(data: MonthlyData) {
  const { property, yearMonth, bills, staff, attendances, staffResults, personalDetails } = data;
  const workbook = createReportWorkbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const money = `"${property.currency.replace(/"/g, '')}" #,##0.00;("${property.currency.replace(/"/g, '')}" #,##0.00);"-"`;

  function heading(row: ExcelJS.Row) {
    row.font = { name: 'Arial', bold: true, size: 10 };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = 24;
    row.eachCell(cell => {
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
    });
  }

  const sheet = (name: string, widths: number[], headerRow = 0, headers: string[] = []) => {
    const ws = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: headerRow > 0 ? headerRow : 0, xSplit: name === 'Attendance' ? 1 : 0, showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: widths.length > 5 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: headerRow > 0 ? `1:${headerRow}` : '1:1',
      },
    });
    widths.forEach((width, index) => {
      ws.getColumn(index + 1).width = width;
    });
    ws.getCell(1, 1).value = `Diving - ${property.name} - Monthly Report - ${yearMonth} - ${name}`;
    ws.getRow(1).font = { name: 'Arial', size: 14, bold: true };
    ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(1).height = widths.length < 4 ? 35 : 28;
    ws.getRow(2).height = 12;

    if (headers.length && headerRow > 0) {
      ws.getRow(headerRow).values = headers;
      heading(ws.getRow(headerRow));
    }
    return ws;
  };

  function amountRow(ws: ExcelJS.Worksheet, values: ExcelJS.CellValue[], moneyCols: number[] = [], total = false) {
    const row = ws.addRow(values);
    for (const col of moneyCols) {
      row.getCell(col).numFmt = money;
    }
    if (total) heading(row);
    return row;
  }

  // -------------------------------------------------------------
  // Sheet 1: Overview
  // -------------------------------------------------------------
  const overview = sheet('Overview', [28, 24, 22, 14, 22]);
  overview.pageSetup.printTitlesRow = '1:1';

  const sales = sum(bills.map(b => b.grossAmount - b.discountAmount));
  const totalSc = sum(bills.map(b => b.serviceChargeAmount));
  const totalComm = sum(staffResults.map(s => s.totalCommission - s.tipsCommission));

  overview.getCell('A3').value = 'Turnover:';
  overview.getCell('A4').value = `Free snorkel gear (according to ${property.currency} 1.50)`;
  overview.getCell('D4').value = null;
  overview.getCell('D4').dataValidation = {
    type: 'whole',
    operator: 'greaterThanOrEqual',
    formulae: [0],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Invalid quantity',
    error: 'Enter a whole number of units, zero or greater.',
  };
  overview.getCell('D4').numFmt = '0';
  overview.getCell('D4').note = 'Enter the monthly quantity manually; enter 0 if none. This adjustment is not recorded on bills.';
  overview.getCell('E4').value = { formula: 'IF(D4="","",ROUND(D4*1.5,2))', result: '' };

  overview.getCell('A5').value = 'Total sales (chargeable items)';
  overview.getCell('E5').value = round(sales);

  overview.getCell('A7').value = 'Total turnover (excluding taxes and service charge):';
  overview.getCell('E7').value = { formula: 'IF(D4="","",SUM(E4:E5))', result: '' };

  overview.getCell('A9').value = 'Service charge:';
  overview.getCell('A10').value = 'Resort service charge';
  overview.getCell('E10').value = round(totalSc);

  overview.getCell('A12').value = 'Total service charge:';
  overview.getCell('E12').value = { formula: 'E10', result: round(totalSc) };

  overview.getCell('A14').value = 'Commission:';
  overview.getCell('A15').value = 'Course, Photo, Tank, Night, Dive, Overriding, GM, Retail';
  overview.getCell('E15').value = round(totalComm);

  overview.getCell('A17').value = 'Total commission:';
  overview.getCell('E17').value = { formula: 'E15', result: round(totalComm) };
  if ((data.unallocatedStoreAttendantPoolTotal ?? 0) > 0) {
    overview.getCell('A23').value = 'Unallocated Store attendant Retail pool';
    overview.getCell('E23').value = data.unallocatedStoreAttendantPoolTotal!;
    overview.getCell('E23').numFmt = money;
  }

  overview.getCell('A20').value = 'Prepared by';
  overview.getCell('A21').value = null;
  overview.getCell('A21').note = 'Enter the report preparer’s name.';

  for (const address of ['D4', 'A21']) {
    overview.getCell(address).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };
  }
  for (const row of [3, 7, 9, 12, 14, 17, 20]) {
    heading(overview.getRow(row));
  }
  for (const row of [4, 5, 10, 15, 21]) {
    overview.getRow(row).height = 24;
  }
  for (const row of [4, 5, 7, 10, 12, 15, 17]) {
    overview.getCell(row, 5).numFmt = money;
  }

  // -------------------------------------------------------------
  // Sheet 2: Item report
  // -------------------------------------------------------------
  const itemSheet = sheet('Item report', [22, 16, 22, 16, 36, 12, 18], 3, ['Main category', 'Sub total', 'Sub category', 'Sub total', 'Item', 'Count', 'Turnover']);
  itemSheet.addRow([]); // Row 4 is blank

  const groups = new Map<string, Map<string, { count: number; turnover: number }>>();
  for (const bill of bills) {
    for (const item of bill.items) {
      const category = item.categoryName || 'Other';
      const group = groups.get(category) || new Map();
      const aggregate = group.get(item.itemName) || { count: 0, turnover: 0 };
      aggregate.count += item.quantity;
      aggregate.turnover += item.lineTotal;
      group.set(item.itemName, aggregate);
      groups.set(category, group);
    }
  }

  const billCategories = [...groups.keys()].sort();
  const itemCategories = billCategories.length ? billCategories : ['Boat', 'Courses', 'Diving', 'L+D', 'Photo', 'Rental', 'Retail'];
  const firstItemDataRow = 5;

  for (const category of itemCategories) {
    const itemsMap = groups.get(category) || new Map();
    const items = [...itemsMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    const subCategory = getSubCategory(category);
    const subtotal = round(sum(items.map(([, v]) => v.turnover)));

    if (!items.length) {
      const row = amountRow(itemSheet, [category, subtotal, subCategory, subtotal, '', 0, 0], [2, 4, 7]);
      row.getCell(6).numFmt = '0';
    } else {
      items.forEach(([name, value], index) => {
        const row = amountRow(
          itemSheet,
          [
            index === 0 ? category : null,
            index === 0 ? subtotal : null,
            index === 0 ? subCategory : null,
            index === 0 ? subtotal : null,
            name,
            value.count,
            round(value.turnover),
          ],
          [2, 4, 7]
        );
        row.getCell(6).numFmt = '0';
      });
    }
  }

  const lastItemDataRow = itemSheet.rowCount;
  itemSheet.addRow([]); // blank row

  const totalItemCount = sum(bills.flatMap(b => b.items.map(i => i.quantity)));
  const totalItemTurnover = round(sum(bills.flatMap(b => b.items.map(i => i.lineTotal))));
  const totalRow = amountRow(
    itemSheet,
    [
      'Total',
      bills.length ? { formula: `G${itemSheet.rowCount + 1}`, result: totalItemTurnover } : 0,
      null,
      bills.length ? { formula: `G${itemSheet.rowCount + 1}`, result: totalItemTurnover } : 0,
      null,
      bills.length ? { formula: `SUM(F${firstItemDataRow}:F${lastItemDataRow})`, result: totalItemCount } : 0,
      bills.length ? { formula: `SUM(G${firstItemDataRow}:G${lastItemDataRow})`, result: totalItemTurnover } : 0,
    ],
    [2, 4, 7],
    true
  );
  totalRow.getCell(6).numFmt = '0';

  itemSheet.addRow([]);
  itemSheet.addRow([]);
  const itemPrepRow = itemSheet.addRow(['Prepared by']);
  heading(itemPrepRow);
  const itemPrepNameRow = itemSheet.addRow([null]);
  itemPrepNameRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };

  // -------------------------------------------------------------
  // Sheet 3: Commission, SC
  // -------------------------------------------------------------
  const commSheet = sheet('Commission, SC', [28, 10, 10, 10, 14, 14, 14, 14, 14, 16]);

  const totalCourse = sum(staffResults.map(s => s.courseCommission));
  const totalDive = sum(staffResults.map(s => s.diveCommission));
  const totalPhoto = sum(personalDetails.filter(d => /photo/i.test(d.role)).map(d => d.amount));
  const totalRetail = sum(personalDetails.filter(d => d.role.startsWith('Store attendant (Retail')).map(d => d.amount));
  const totalNight = 0;
  const totalTank = 0;
  const subTotalCommission = totalCourse + totalPhoto + totalNight + totalTank + totalDive;
  const overrideCommission = sum(staffResults.map(s => s.overrideCommission));
  const totalCommissionPaid = subTotalCommission + overrideCommission + totalRetail;

  // Top summary rows 3..15
  amountRow(commSheet, ['Course commission', null, null, null, null, null, null, null, null, round(totalCourse)], [10]);
  amountRow(commSheet, ['Photo commission', null, null, null, null, null, null, null, null, round(totalPhoto)], [10]);
  amountRow(commSheet, ['Night dive commission', null, null, null, null, null, null, null, null, round(totalNight)], [10]);
  amountRow(commSheet, ['Tank commission', null, null, null, null, null, null, null, null, round(totalTank)], [10]);
  amountRow(commSheet, ['Dive commission', null, null, null, null, null, null, null, null, round(totalDive)], [10]);
  commSheet.addRow([]);
  amountRow(commSheet, ['Sub total', null, null, null, null, null, null, null, null, { formula: 'SUM(J3:J7)', result: round(subTotalCommission) }], [10], true);
  commSheet.addRow([]);
  amountRow(commSheet, ['Overriding commission, additional for base leader (10% of course/dive commission)', null, null, null, null, null, null, null, 1, round(overrideCommission)], [10]);
  amountRow(commSheet, ['Share of overriding commission for ass. base leader', null, null, null, null, null, null, null, 0, 0], [10]);
  amountRow(commSheet, ['General Manager commission (25% of base leader OR/course/dive commission)', null, null, null, null, null, null, null, null, 0], [10]);
  commSheet.addRow([]);
  commSheet.getCell('A14').value = 'Store attendant commission (Retail 5% shared)';
  commSheet.getCell('J14').value = round(totalRetail);
  commSheet.getCell('J14').numFmt = money;
  amountRow(commSheet, ['Total commission to be paid', null, null, null, null, null, null, null, null, { formula: 'SUM(J9:J14)', result: round(totalCommissionPaid) }], [10], true);
  commSheet.addRow([]);
  commSheet.addRow([]);
  commSheet.addRow([]);

  // Rows 19-20: Staff table headers
  commSheet.getRow(19).values = ['Staff member', null, null, null, 'Commission', null, null, null, null, 'Total'];
  commSheet.getCell('E19').alignment = { horizontal: 'center', vertical: 'middle' };
  heading(commSheet.getRow(19));

  commSheet.getRow(20).values = [null, null, null, null, 'Course', 'Photo', 'Retail (5%)', 'Tank', 'Dive', null];
  heading(commSheet.getRow(20));

  const attendanceStaff = new Map(staff.filter(s => s.isDiveStaff).map(s => [s.id, s]));
  for (const record of attendances as (Attendance & { staffMember?: StaffMember })[]) {
    if (record.staffMember?.isDiveStaff) attendanceStaff.set(record.staffMember.id, record.staffMember);
  }
  for (const r of staffResults) {
    const s = staff.find(member => member.id === r.staffId);
    if (s && !attendanceStaff.has(s.id)) attendanceStaff.set(s.id, s);
  }
  const people = [...attendanceStaff.values()].sort((a, b) => a.name.localeCompare(b.name));

  const staffStartRow = 21;
  for (const person of people) {
    const r = staffResults.find(res => res.staffId === person.id);
    const course = r ? r.courseCommission : 0;
    const dive = r ? r.diveCommission : 0;
    const photo = sum(personalDetails.filter(d => d.staffId === person.id && /photo/i.test(d.role)).map(d => d.amount));
    const retail = sum(personalDetails.filter(d => d.staffId === person.id && d.role.startsWith('Store attendant (Retail')).map(d => d.amount));
    const tank = 0;
    const staffTot = round(course + photo + retail + tank + dive);
    const currentR = commSheet.rowCount + 1;
    amountRow(
      commSheet,
      [
        person.name,
        null,
        '?',
        null,
        round(course),
        round(photo),
        round(retail),
        null,
        round(dive),
        { formula: `SUM(E${currentR}:I${currentR})`, result: staffTot },
      ],
      [5, 6, 7, 8, 9, 10]
    );
  }

  const staffEndRow = commSheet.rowCount;
  commSheet.addRow([]);
  amountRow(commSheet, ['Other staff', null, null, null, null, null, null, null, null, 0], [10]);
  commSheet.addRow([]);

  const commTotalRow = amountRow(
    commSheet,
    [
      'Total',
      null,
      0,
      null,
      staffEndRow >= staffStartRow ? { formula: `SUM(E${staffStartRow}:E${staffEndRow})`, result: round(totalCourse) } : 0,
      staffEndRow >= staffStartRow ? { formula: `SUM(F${staffStartRow}:F${staffEndRow})`, result: round(totalPhoto) } : 0,
      staffEndRow >= staffStartRow ? { formula: `SUM(G${staffStartRow}:G${staffEndRow})`, result: round(totalRetail) } : 0,
      0,
      staffEndRow >= staffStartRow ? { formula: `SUM(I${staffStartRow}:I${staffEndRow})`, result: round(totalDive) } : 0,
      staffEndRow >= staffStartRow ? { formula: `SUM(J${staffStartRow}:J${staffEndRow})`, result: round(subTotalCommission + totalRetail) } : 0,
    ],
    [5, 6, 7, 8, 9, 10],
    true
  );
  commTotalRow.getCell(3).alignment = { horizontal: 'center' };

  commSheet.addRow([null, null, null, null, 0, null, null, null, null, null]);
  commSheet.addRow([]);
  commSheet.addRow([]);
  const commPrepRow = commSheet.addRow(['Prepared by']);
  heading(commPrepRow);
  const commPrepNameRow = commSheet.addRow([null]);
  commPrepNameRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };

  // -------------------------------------------------------------
  // Sheet 4: All bills
  // -------------------------------------------------------------
  const billItemCategories = [...new Set(bills.flatMap(b => b.items.map(i => i.categoryName || 'Other')))].sort();
  const billCategoriesForSheet = billItemCategories.length ? billItemCategories : ['Boat', 'Courses', 'Diving', 'L+D', 'Photo', 'Rental', 'Retail'];
  const billHeaders = ['Check', 'Room', 'Name', ...billCategoriesForSheet, 'Total', 'SC', 'Taxes', 'Sum'];
  const billWidths = [14, 12, 26, ...billCategoriesForSheet.map(() => 16), 18, 16, 16, 18];

  const billSheet = sheet('All bills', billWidths, 3, billHeaders);
  billSheet.addRow([]); // Row 4 is blank

  const billStartRow = 5;
  for (const bill of bills) {
    const catAmounts = billCategoriesForSheet.map(cat => round(sum(bill.items.filter(i => (i.categoryName || 'Other') === cat).map(i => i.lineTotal))));
    const billTot = round(bill.grossAmount - bill.discountAmount);
    const billSc = round(bill.serviceChargeAmount);
    const billTax = round(bill.taxAmount);
    const billSum = round(billTot + billSc + billTax);
    amountRow(
      billSheet,
      [bill.checkNumber, bill.roomNumber, bill.guestName, ...catAmounts, billTot, billSc, billTax, billSum],
      Array.from({ length: billCategoriesForSheet.length + 4 }, (_, i) => i + 4)
    );
  }

  const billEndRow = billSheet.rowCount;
  billSheet.addRow([]); // Blank row before Totals

  const billTotals: ExcelJS.CellValue[] = ['Totals', null, null];
  const lastCol = billCategoriesForSheet.length + 7;
  for (let c = 4; c <= lastCol; c++) {
    const colLetter = billSheet.getColumn(c).letter;
    if (billEndRow >= billStartRow) {
      const sumVal = sum(Array.from({ length: billEndRow - billStartRow + 1 }, (_, i) => Number(billSheet.getCell(billStartRow + i, c).value) || 0));
      billTotals.push({ formula: `SUM(${colLetter}${billStartRow}:${colLetter}${billEndRow})`, result: round(sumVal) });
    } else {
      billTotals.push(0);
    }
  }

  amountRow(billSheet, billTotals, Array.from({ length: billCategoriesForSheet.length + 4 }, (_, i) => i + 4), true);

  if (bills.length) {
    billSheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: billEndRow, column: lastCol } };
  }

  billSheet.addRow([]);
  billSheet.addRow([]);
  const billPrepRow = billSheet.addRow(['Prepared by']);
  heading(billPrepRow);
  const billPrepNameRow = billSheet.addRow([null]);
  billPrepNameRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };

  // -------------------------------------------------------------
  // Sheet 5: Attendance
  // -------------------------------------------------------------
  const attendHeaders = ['Date', ...people.map(s => s.name), ...(!people.length ? ['No staff'] : [])];
  const attendWidths = [16, ...Array(Math.max(1, people.length)).fill(14)];
  const attendance = sheet('Attendance', attendWidths, 3, attendHeaders);
  attendance.getRow(3).height = people.length > 5 ? 80 : 30;
  people.forEach((_, index) => {
    attendance.getCell(3, index + 2).alignment = { textRotation: 90, vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  const [yearNum, monthNum] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
  const statuses = new Map(attendances.map(a => [`${a.staffMemberId}:${a.date}`, a.status]));

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`;
    const dateObj = new Date(Date.UTC(yearNum, monthNum - 1, day, 12, 0, 0));
    const row = attendance.addRow([dateObj, ...people.map(s => codes[statuses.get(`${s.id}:${dateStr}`) || ''] || '')]);
    row.getCell(1).numFmt = 'dd/mm/yyyy';
    row.eachCell((cell, col) => {
      if (col > 1) cell.alignment = { horizontal: 'center' };
    });
  }

  attendance.addRow([]);
  const count = (id: string, status: string) => attendances.filter(a => a.staffMemberId === id && a.status === status).length;
  const attendanceSummary: [string, (id: string) => number][] = [
    ['at work', id => count(id, 'PRESENT') + count(id, 'OFF_HALF') / 2],
    ['off', id => count(id, 'OFF') + count(id, 'OFF_HALF') / 2],
    ['annual leave', id => count(id, 'ANNUAL_LEAVE')],
    ['sick', id => count(id, 'SICK')],
    ['non payable', id => daysInMonth - (count(id, 'PRESENT') + count(id, 'OFF') + count(id, 'OFF_HALF'))],
    ['total payable days', id => count(id, 'PRESENT') + count(id, 'OFF') + count(id, 'OFF_HALF')],
  ];

  for (const [label, fn] of attendanceSummary) {
    const row = attendance.addRow([label, ...people.map(s => fn(s.id))]);
    row.height = 24;
    row.eachCell((cell, col) => {
      if (col > 1) cell.alignment = { horizontal: 'center' };
    });
  }

  attendance.addRow([]);
  attendance.addRow([]);
  const attendPrepRow = attendance.addRow(['Prepared by']);
  heading(attendPrepRow);
  const attendPrepNameRow = attendance.addRow([null]);
  attendPrepNameRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };

  // -------------------------------------------------------------
  // Sheet 6: Room report
  // -------------------------------------------------------------
  const roomSheet = sheet('Room report', [20, 24], 3, ['Room', 'Turnover']);
  roomSheet.addRow([]); // Row 4 is blank

  const rooms = new Map<string, number>();
  for (const bill of bills) {
    rooms.set(bill.roomNumber, (rooms.get(bill.roomNumber) || 0) + bill.grossAmount - bill.discountAmount);
  }

  const roomStartRow = 5;
  for (const [room, value] of [...rooms].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    amountRow(roomSheet, [room, round(value)], [2]);
  }
  const roomEndRow = roomSheet.rowCount;

  roomSheet.addRow([]); // Blank row
  const roomTotalVal = round(sum([...rooms.values()]));
  amountRow(
    roomSheet,
    ['Total', roomEndRow >= roomStartRow ? { formula: `SUM(B${roomStartRow}:B${roomEndRow})`, result: roomTotalVal } : 0],
    [2],
    true
  );

  // -------------------------------------------------------------
  // Universal page setup & cell styling
  // -------------------------------------------------------------
  for (const ws of workbook.worksheets) {
    ws.eachRow(row => {
      row.eachCell(cell => {
        cell.font = { name: 'Arial', size: 10, ...cell.font };
        cell.border = {
          top: { style: 'hair', color: { argb: 'FFAAAAAA' } },
          bottom: { style: 'hair', color: { argb: 'FFAAAAAA' } },
          left: { style: 'hair', color: { argb: 'FFAAAAAA' } },
          right: { style: 'hair', color: { argb: 'FFAAAAAA' } },
          ...cell.border,
        };
        cell.alignment = { vertical: 'middle', wrapText: true, ...cell.alignment };
      });
    });
    ws.pageSetup.printArea = `A1:${ws.getColumn(ws.columnCount).letter}${ws.rowCount}`;
    ws.headerFooter.oddFooter = `&L${property.name} | ${yearMonth}&RPage &P of &N`;
  }

  return workbook;
}
