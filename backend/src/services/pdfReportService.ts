import { prisma } from '../db';
import { calculateCommissionForPeriod } from './commissionService';
import { isBusinessDate, isYearMonth } from '../utils/dates';
import { renderReportPdf, ReportTable, ReportCell } from './reportPdfRenderer';

const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const column = (label: string, width = 78, numeric = false) => ({ label, width, numeric });
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export async function generateReportPdf(propertyId: string, period: string, monthly: boolean) {
  if (monthly ? !isYearMonth(period) : !isBusinessDate(period)) throw new Error('Choose a valid report period.');
  const start = monthly ? `${period}-01` : period;
  const end = monthly ? new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10) : period;
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error('Property not found');
  const bills = await prisma.bill.findMany({ where: { propertyId, status: 'ACTIVE', businessDate: { gte: start, lte: end } },
    include: { items: true }, orderBy: [{ businessDate: 'asc' }, { checkNumber: 'asc' }] });
  const commission = await calculateCommissionForPeriod(propertyId, start, end);
  const tables: ReportTable[] = [];
  const sales = sum(bills.map(bill => bill.grossAmount - bill.discountAmount));
  tables.push({ title: 'Overview', columns: [column('Metric', 340), column(`Amount / value (${property.currency})`, 170, true)], rows: [
    ['Active bills', bills.length], ['Gross sales', money(sum(bills.map(bill => bill.grossAmount)))],
    ['Discounts', money(sum(bills.map(bill => bill.discountAmount)))], ['Sales after discounts', money(sales)],
    ['Service charge', money(sum(bills.map(bill => bill.serviceChargeAmount)))], ['Tax', money(sum(bills.map(bill => bill.taxAmount)))],
    ['Guest tips', money(sum(bills.map(bill => bill.tipAmount)))], ['Grand total', money(sum(bills.map(bill => bill.netAmount)))],
    ['Staff commission excluding tips', money(sum(commission.staffResults.map(row => row.totalCommission - row.tipsCommission)))],
    ['Total staff pay including tips', money(commission.grandTotal)],
    ['Certifications pool (not paid to staff)', money(commission.certificationPoolTotal)],
    ['Store attendant Retail pool (5% shared)', money(commission.storeAttendantPoolTotal)],
    ['Unallocated Retail pool (no eligible attendants)', money(commission.unallocatedStoreAttendantPoolTotal)],
  ], note: 'Only active bills are included. Amounts are in the property currency. Retail payments are included in Personal commission. Free snorkel gear adjustments are not recorded on bills and are not included.' });

  if (monthly) {
    const items = new Map<string, { category: string; name: string; quantity: number; turnover: number }>();
    for (const bill of bills) for (const line of bill.items) {
      const key = JSON.stringify([line.categoryName, line.itemName]);
      const item = items.get(key) ?? { category: line.categoryName, name: line.itemName, quantity: 0, turnover: 0 };
      item.quantity += line.quantity; item.turnover += line.lineTotal; items.set(key, item);
    }
    const sorted = [...items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    const itemRows: ReportCell[][] = [];
    for (const category of [...new Set(sorted.map(item => item.category))]) {
      const categoryItems = sorted.filter(item => item.category === category);
      itemRows.push(...categoryItems.map(item => [item.category, item.name, item.quantity, money(item.turnover)]),
        [`${category} subtotal`, '', sum(categoryItems.map(item => item.quantity)), money(sum(categoryItems.map(item => item.turnover)))]);
    }
    tables.push({ title: 'Item report', columns: [column('Category', 135), column('Item / activity', 280), column('Quantity', 90, true), column('Turnover', 110, true)],
      rows: [...itemRows, ['TOTAL', '', sum(sorted.map(item => item.quantity)), money(sum(sorted.map(item => item.turnover)))]] });
  }
  const staffRows = commission.staffResults;
  tables.push({ title: 'Commission and staff pay', repeatColumns: 1,
    columns: [column('Staff member', 145), column('Role', 115), ...['Course', 'Dive', 'Override', 'Tips', 'Personal', 'Total pay'].map(label => column(label, 80, true))],
    rows: [...staffRows.map(row => [row.staffName, row.roleTitle, ...[row.courseCommission, row.diveCommission, row.overrideCommission, row.tipsCommission, row.personalCommission, row.totalCommission].map(money)]),
      ['TOTAL', '', ...['courseCommission', 'diveCommission', 'overrideCommission', 'tipsCommission', 'personalCommission', 'totalCommission'].map(key => money(sum(staffRows.map(row => row[key as keyof typeof row] as number))))]],
    note: 'Personal includes the shared Store attendant Retail allocation and assigned employee payments. Certifications are excluded from staff pay.' });
  if (commission.personalDetails.length) tables.push({ title: 'Commission details', repeatColumns: 2,
    columns: [column('Date', 80), column('Check', 55), column('Room', 55), column('Guest', 105), column('Item / activity', 135), column('Payment role', 130), column('Employee', 115), column('Amount', 80, true)],
    rows: commission.personalDetails.map(row => [row.businessDate, row.checkNumber, row.roomNumber, row.guestName, row.itemName, row.role, row.staffName, money(row.amount)]) });

  const categories = [...new Set(bills.flatMap(bill => bill.items.map(line => line.categoryName)))].sort();
  const fixedBillColumns = [column('Check', 65), column('Room', 60), column('Guest', 135), column('Date', 85), column('Nationality', 95)];
  const billColumns = [...fixedBillColumns, ...(monthly ? categories.map(name => column(name, 90, true)) : [column('Items', 60, true)]),
    ...['Gross', 'Discount', 'Sales', 'Service charge', 'Tax', 'Tip', 'Grand total'].map(label => column(label, 90, true))];
  const billRows: ReportCell[][] = bills.map(bill => [bill.checkNumber, bill.roomNumber, bill.guestName, bill.businessDate, bill.nationality,
    ...(monthly ? categories.map(category => money(sum(bill.items.filter(line => line.categoryName === category).map(line => line.lineTotal)))) : [bill.items.length]),
    ...[bill.grossAmount, bill.discountAmount, bill.grossAmount - bill.discountAmount, bill.serviceChargeAmount, bill.taxAmount, bill.tipAmount, bill.netAmount].map(money)]);
  billRows.push(['TOTAL', '', '', '', '', ...(monthly ? categories.map(category => money(sum(bills.flatMap(bill => bill.items.filter(line => line.categoryName === category).map(line => line.lineTotal))))) : [sum(bills.map(bill => bill.items.length))]),
    ...[sum(bills.map(bill => bill.grossAmount)), sum(bills.map(bill => bill.discountAmount)), sales, sum(bills.map(bill => bill.serviceChargeAmount)), sum(bills.map(bill => bill.taxAmount)), sum(bills.map(bill => bill.tipAmount)), sum(bills.map(bill => bill.netAmount))].map(money)]);
  tables.push({ title: monthly ? 'All bills' : 'Daily bills', repeatColumns: 3, columns: billColumns, rows: billRows,
    note: 'Wide reports continue in column groups. Check, room and guest repeat in each group.' });

  if (monthly) {
    const staff = await prisma.staffMember.findMany({ where: { propertyId, hireDate: { lte: end }, OR: [{ leavingDate: null }, { leavingDate: { gte: start } }] }, orderBy: { name: 'asc' } });
    const attendance = await prisma.attendance.findMany({ where: { propertyId, staffMember: { propertyId }, date: { gte: start, lte: end } } });
    const statuses = new Map(attendance.map(row => [`${row.staffMemberId}:${row.date}`, row.status]));
    const codes: Record<string, string> = { PRESENT: 'P', OFF: 'O', OFF_HALF: 'O 1/2', ANNUAL_LEAVE: 'AL', SICK: 'S', ABSENT: 'A', EMERGENCY_LEAVE: 'EL' };
    const rows: ReportCell[][] = [];
    for (let day = 1; day <= Number(end.slice(-2)); day++) {
      const date = `${period}-${String(day).padStart(2, '0')}`;
      rows.push([date, ...staff.map(person => {
        if (person.hireDate > date || (person.leavingDate && person.leavingDate < date)) return '-';
        const status = statuses.get(`${person.id}:${date}`);
        return status ? codes[status] ?? status : '';
      })]);
    }
    const count = (id: string, status: string) => attendance.filter(row => row.staffMemberId === id && row.status === status).length;
    rows.push(['At work', ...staff.map(person => count(person.id, 'PRESENT') + count(person.id, 'OFF_HALF') / 2)],
      ['Off', ...staff.map(person => count(person.id, 'OFF') + count(person.id, 'OFF_HALF') / 2)],
      ['Annual leave', ...staff.map(person => count(person.id, 'ANNUAL_LEAVE'))], ['Sick', ...staff.map(person => count(person.id, 'SICK'))],
      ['Absent', ...staff.map(person => count(person.id, 'ABSENT'))], ['Emergency leave', ...staff.map(person => count(person.id, 'EMERGENCY_LEAVE'))],
      ['Payable days', ...staff.map(person => count(person.id, 'PRESENT') + count(person.id, 'OFF') + count(person.id, 'OFF_HALF'))]);
    tables.push({ title: 'Attendance', compact: true, columns: [column('Date / summary', 105), ...staff.map(person => column(person.name, 100))], rows,
      note: 'P: present | O: off | O 1/2: half off | AL: annual leave | S: sick | A: absent | EL: emergency leave. Blank means no saved attendance; - means outside employment dates. Dates repeat for each staff column group.' });
    const rooms = new Map<string, number>();
    for (const bill of bills) rooms.set(bill.roomNumber, (rooms.get(bill.roomNumber) ?? 0) + bill.grossAmount - bill.discountAmount);
    tables.push({ title: 'Room report', columns: [column('Room', 200), column('Turnover after discounts', 200, true)],
      rows: [...[...rooms].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([room, turnover]) => [room, money(turnover)]), ['TOTAL', money(sales)]] });
  }
  return renderReportPdf(`${property.name} - ${monthly ? 'Monthly' : 'Daily'} report`, `${period} | ${property.currency} | Active bills only`, tables);
}

export const generateDailyPdfReport = (propertyId: string, date: string) => generateReportPdf(propertyId, date, false);
export const generateMonthlyPdfReport = (propertyId: string, month: string) => generateReportPdf(propertyId, month, true);
