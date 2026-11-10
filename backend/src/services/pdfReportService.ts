import { prisma } from '../db';
import { calculateCommissionForPeriod } from './commissionService';
import { businessToday, businessWeek, businessMonth, isBusinessDate, isYearMonth } from '../utils/dates';
import { renderReportPdf, ReportTable, ReportCell } from './reportPdfRenderer';

const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const column = (label: string, width = 78, numeric = false, minWidth?: number, align?: 'left' | 'center' | 'right') => ({ label, width, numeric, minWidth, align });
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const amounts = (values: [string, number][]) => values.map(([label, value]) => `${label}: ${money(value)}`).join('\n');
const staffBreakdown = (row: { courseCommission: number; diveCommission: number; overrideCommission: number; personalCommission: number }) => {
  const components: [string, number][] = [['Course', row.courseCommission], ['Dive', row.diveCommission], ['Override', row.overrideCommission], ['Personal', row.personalCommission]];
  return amounts(components.filter(([, value]) => value !== 0)) || 'No commission';
};

// Report-only classification: retain the commission engine's saved payments and totals.
const personalSplit = (staffId: string, total: number, details: { staffId: string; role: string; amount: number }[]) => {
  const selected = details.filter(detail => detail.staffId === staffId);
  const cents = (role: (value: string) => boolean) => Math.round(sum(selected.filter(detail => role(detail.role)).map(detail => detail.amount)) * 100);
  const photo = cents(role => role === 'Photo' || role === 'Photo / Video');
  const upselling = cents(role => role === 'Seller');
  const guiding = cents(role => role === 'Guide');
  return [photo, upselling, guiding, Math.round(total * 100) - photo - upselling - guiding].map(value => value / 100);
};

export async function generateReportPdf(propertyId: string, period: string, monthly: boolean | 'weekly', preparedByName = 'System generated') {
  if (monthly === true ? !isYearMonth(period) : !isBusinessDate(period)) throw new Error('Choose a valid report period.');
  const week = monthly === 'weekly' ? businessWeek(period) : null;
  if (monthly === 'weekly' && !week) throw new Error('Choose a valid report week.');
  const start = week ? week.start : monthly ? `${period}-01` : period;
  const end = week ? week.end : monthly ? businessMonth(period)!.end : period;
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error('Property not found');
  const bills = await prisma.bill.findMany({ where: { propertyId, status: 'ACTIVE', businessDate: { gte: start, lte: end } },
    include: { items: true }, orderBy: [{ businessDate: 'asc' }, { checkNumber: 'asc' }] });
  const tables: ReportTable[] = [];
  const iruFushiLetterhead = /^(sun\s+siyam\s+)?iru\s*fushi$/i.test(property.name.trim());
  const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const periodLabel = week ? `${formatDate(start)} - ${formatDate(end)}` : new Intl.DateTimeFormat('en-GB', { ...(monthly ? {} : { day: '2-digit' as const }), month: 'long', year: 'numeric', timeZone: 'Indian/Maldives' }).format(new Date(`${start}T12:00:00Z`));
  const preparedBy = { name: preparedByName, date: businessToday() };
  if (!monthly) {
    const total = (field: 'grossAmount' | 'discountAmount' | 'serviceChargeAmount' | 'taxAmount' | 'tipAmount' | 'netAmount') => money(sum(bills.map(bill => bill[field])));
    tables.push({ title: 'Bills', singleTable: true, compact: true,
      columns: [column('Check #', 55), column('Room #', 48), column('Guest name', 125), column('Nationality', 95), column('Items count', 48, true),
        column('Gross', 65, true), column('Discount', 65, true), column('Service charge', 70, true), column('Tax', 65, true), column('Tip', 55, true), column('Net total', 82, true)],
      rows: [...bills.map(bill => [bill.checkNumber, bill.roomNumber, bill.guestName, bill.nationality, bill.items.length,
        money(bill.grossAmount), money(bill.discountAmount), money(bill.serviceChargeAmount), money(bill.taxAmount), money(bill.tipAmount), money(bill.netAmount)]),
        ['TOTAL', '', '', '', sum(bills.map(bill => bill.items.length)), total('grossAmount'), total('discountAmount'), total('serviceChargeAmount'), total('taxAmount'), total('tipAmount'), total('netAmount')]],
      note: `${bills.length} active bill${bills.length === 1 ? '' : 's'}. Items count is the number of saved bill lines. Amounts in ${property.currency}.` });
    return renderReportPdf(`${property.name} - Daily report`, `${periodLabel} | ${property.currency} | Active bills only`, tables,
      { signOff: true, signOffPosition: 'bottom', preparedBy, logo: iruFushiLetterhead ? 'iru-fushi' : 'dive-centre' });
  }
  const commission = await calculateCommissionForPeriod(propertyId, start, end);
  const sales = sum(bills.map(bill => bill.grossAmount - bill.discountAmount));
  tables.push({ title: 'Overview', emphasizeRows: [3, 7, 9], columns: [column('Metric', 340), column(`Amount / value (${property.currency})`, 170, true)], rows: [
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

  const categories = new Map<string, { quantity: number; turnover: number }>();
  for (const bill of bills) for (const line of bill.items) {
    const category = categories.get(line.categoryName) ?? { quantity: 0, turnover: 0 };
    category.quantity += line.quantity; category.turnover += line.lineTotal;
    categories.set(line.categoryName, category);
  }
  const categoryRows = [...categories].sort(([a], [b]) => a.localeCompare(b));
  tables.push({ title: 'Category summary', singleTable: true,
    columns: [column('Category', 290, false, 180), column('Quantity', 90, true, 65), column('Sales after discounts', 140, true, 110)],
    rows: [...categoryRows.map(([name, value]) => [name, value.quantity, money(value.turnover)]),
      ['TOTAL', sum(categoryRows.map(([, value]) => value.quantity)), money(sum(categoryRows.map(([, value]) => value.turnover)))]],
    note: 'Category sales are based on saved bill items after discounts, excluding service charge, tax and tips.' });

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
    tables.push({ title: 'Item report', singleTable: true, columns: [column('Category', 135), column('Item / activity', 280), column('Quantity', 90, true), column('Turnover', 110, true)],
      rows: [...itemRows, ['TOTAL', '', sum(sorted.map(item => item.quantity)), money(sum(sorted.map(item => item.turnover)))]] });
  }
  const staffRows = commission.staffResults;
  const staffTotals = {
    courseCommission: sum(staffRows.map(row => row.courseCommission)), diveCommission: sum(staffRows.map(row => row.diveCommission)),
    overrideCommission: sum(staffRows.map(row => row.overrideCommission)), personalCommission: sum(staffRows.map(row => row.personalCommission)),
    tipsCommission: sum(staffRows.map(row => row.tipsCommission)), totalCommission: sum(staffRows.map(row => row.totalCommission)),
  };
  tables.push({ title: 'Staff payments', singleTable: true,
    columns: [column('Employee', 175, false, 145), column('Commission breakdown', 205, false, 175), column('Total pay / tips', 130, false, 120, 'right')],
    rows: [...staffRows.map(row => [`${row.staffName}\n${row.roleTitle}`, staffBreakdown(row), `${money(row.totalCommission)}\nTips: ${money(row.tipsCommission)}`]),
      ['TOTAL', staffBreakdown(staffTotals), `${money(staffTotals.totalCommission)}\nTips: ${money(staffTotals.tipsCommission)}`]],
    note: 'Total pay includes tips. Only non-zero commission components are listed. Personal includes the shared Store attendant Retail allocation and assigned payments. Certifications are excluded from staff pay.' });
  const splitRows = staffRows.map(row => ({ name: row.staffName, values: personalSplit(row.staffId, row.personalCommission, commission.personalDetails), total: row.personalCommission }));
  tables.push({ title: 'Personal commission summary', singleTable: true, compact: true,
    columns: [column('Employee', 180), column('Photo', 75, true), column('Upselling', 75, true), column('Guiding', 75, true), column('Other / rounding', 85, true), column('Personal total', 85, true)],
    rows: [...splitRows.map(row => [row.name, ...row.values.map(money), money(row.total)]),
      ['TOTAL', ...[0, 1, 2, 3].map(index => money(sum(splitRows.map(row => row.values[index])))), money(staffTotals.personalCommission)]],
    note: 'Photo includes Photo and Photo / Video payments. Upselling is Seller commission; Guiding is Guide commission. Other includes instructor, separate video and Retail payments, plus any cent rounding adjustment. These amounts split Personal commission and are already included in Staff payments.' });
  if (commission.personalDetails.length) tables.push({ title: 'Commission details', singleTable: true,
    columns: [column('Bill / guest', 140, false, 115), column('Item / activity', 145, false, 120), column('Employee / payment', 155, false, 130), column('Amount', 80, true, 70)],
    rows: commission.personalDetails.map(row => [`#${row.checkNumber}\n${row.businessDate}\nRoom: ${row.roomNumber}\n${row.guestName}`, row.itemName, `${row.staffName}\n${row.role}`, money(row.amount)]) });

  const billRows: ReportCell[][] = bills.map(bill => [
    `#${bill.checkNumber}\n${bill.guestName}\nRoom: ${bill.roomNumber}\nDate: ${bill.businessDate}\nNationality: ${bill.nationality}\nItems: ${bill.items.length}`,
    `${money(bill.grossAmount - bill.discountAmount)}\n${amounts([['Gross', bill.grossAmount], ['Discount', bill.discountAmount]])}`,
    amounts([['Service', bill.serviceChargeAmount], ['Tax', bill.taxAmount], ['Tip', bill.tipAmount]]), money(bill.netAmount),
  ]);
  billRows.push([`TOTAL\nItems: ${sum(bills.map(bill => bill.items.length))}`,
    `${money(sales)}\n${amounts([['Gross', sum(bills.map(bill => bill.grossAmount))], ['Discount', sum(bills.map(bill => bill.discountAmount))]])}`,
    amounts([['Service', sum(bills.map(bill => bill.serviceChargeAmount))], ['Tax', sum(bills.map(bill => bill.taxAmount))], ['Tip', sum(bills.map(bill => bill.tipAmount))]]),
    money(sum(bills.map(bill => bill.netAmount)))]);
  tables.push({ title: 'Bill totals', singleTable: true, emphasizeRows: [billRows.length - 1],
    columns: [column('Bill / guest', 180, false, 140), column('Sales', 110, false, 105, 'right'), column('Charges', 125, false, 115), column('Grand total', 100, true, 95)], rows: billRows,
    note: 'Sales are after discounts. Charges list service charge, tax and guest tips. Category sales are shown separately in the Category summary.' });

  if (monthly) {
    const staff = await prisma.staffMember.findMany({ where: { propertyId, hireDate: { lte: end }, OR: [{ leavingDate: null }, { leavingDate: { gte: start } }] }, orderBy: { name: 'asc' } });
    const attendance = await prisma.attendance.findMany({ where: { propertyId, staffMember: { propertyId }, date: { gte: start, lte: end } } });
    const statuses = new Map(attendance.map(row => [`${row.staffMemberId}:${row.date}`, row.status]));
    const codes: Record<string, string> = { BASIC: 'B', PRESENT: 'P', OFF: 'O', OFF_HALF: 'O 1/2', ANNUAL_LEAVE: 'AL', SICK: 'S', ABSENT: 'A', EMERGENCY_LEAVE: 'EL' };
    const rows: ReportCell[][] = [];
    for (const day = new Date(`${start}T12:00:00Z`); day.getTime() <= new Date(`${end}T12:00:00Z`).getTime(); day.setUTCDate(day.getUTCDate() + 1)) {
      const date = day.toISOString().slice(0, 10);
      rows.push([date, ...staff.map(person => {
        if (person.hireDate > date || (person.leavingDate && person.leavingDate < date)) return '-';
        const status = statuses.get(`${person.id}:${date}`);
        return status ? codes[status] ?? status : '';
      })]);
    }
    const count = (id: string, status: string) => attendance.filter(row => row.staffMemberId === id && row.status === status).length;
    rows.push(['At work', ...staff.map(person => count(person.id, 'PRESENT') + count(person.id, 'BASIC') + count(person.id, 'OFF_HALF') / 2)],
      ['Basic (no commission)', ...staff.map(person => count(person.id, 'BASIC'))],
      ['Off', ...staff.map(person => count(person.id, 'OFF') + count(person.id, 'OFF_HALF') / 2)],
      ['Annual leave', ...staff.map(person => count(person.id, 'ANNUAL_LEAVE'))], ['Sick', ...staff.map(person => count(person.id, 'SICK'))],
      ['Absent', ...staff.map(person => count(person.id, 'ABSENT'))], ['Emergency leave', ...staff.map(person => count(person.id, 'EMERGENCY_LEAVE'))],
      ['Payable days', ...staff.map(person => count(person.id, 'PRESENT') + count(person.id, 'OFF') + count(person.id, 'OFF_HALF') + count(person.id, 'BASIC'))]);
    tables.push({ title: 'Attendance', compact: true, emphasizeRows: [rows.length - 1], columns: [column('Date / summary', 105, false, 95), ...staff.map(person => column(person.name, 100, false, 90))], rows,
      note: 'B: basic (payable, no commission) | P: present | O: off | O 1/2: half off | AL: annual leave | S: sick | A: absent | EL: emergency leave. Blank means no saved attendance; - means outside employment dates. Dates repeat for each staff column group.' });
    const rooms = new Map<string, number>();
    for (const bill of bills) rooms.set(bill.roomNumber, (rooms.get(bill.roomNumber) ?? 0) + bill.grossAmount - bill.discountAmount);
    tables.push({ title: 'Room report', columns: [column('Room', 200), column('Turnover after discounts', 200, true)],
      rows: [...[...rooms].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([room, turnover]) => [room, money(turnover)]), ['TOTAL', money(sales)]] });
  }
  return renderReportPdf(`${property.name} - ${week ? 'Weekly' : 'Monthly'} report`, `${periodLabel} | ${property.currency} | Active bills only`, tables,
    { signOff: true, preparedBy, ...(iruFushiLetterhead ? { letterhead: 'iru-fushi' as const } : { logo: 'dive-centre' as const }) });
}

export const generateDailyPdfReport = (propertyId: string, date: string, preparedByName?: string) => generateReportPdf(propertyId, date, false, preparedByName);
export const generateMonthlyPdfReport = (propertyId: string, month: string, preparedByName?: string) => generateReportPdf(propertyId, month, true, preparedByName);

export const generateWeeklyPdfReport = (propertyId: string, date: string, preparedByName?: string) => generateReportPdf(propertyId, date, 'weekly', preparedByName);
