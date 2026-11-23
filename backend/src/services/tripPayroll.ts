import { csvCell } from '../utils/csv';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { createReportWorkbook, styleReportHeader } from './reportWorkbook';

export async function tripPayroll(propertyId: string, startDate: string, endDate: string) {
  return prisma.$transaction(async tx => {
    const where = { propertyId, status: 'APPROVED', businessDate: { gte: startDate, lte: endDate } };
    const groups = await tx.tankCommissionAllocation.groupBy({
      by: ['staffId'], where: { session: where }, _count: { _all: true }, _sum: { amountCents: true },
    });
    const staff = await tx.staffMember.findMany({ where: { id: { in: groups.map(row => row.staffId) }, propertyId }, select: { id: true, name: true, erNumber: true } });
    const rows = groups.map(group => {
      const member = staff.find(row => row.id === group.staffId)!;
      return { staffId: group.staffId, staffName: member.name, erNumber: member.erNumber, tripsWorked: group._count._all, totalCommissionCents: group._sum.amountCents ?? 0 };
    }).sort((a, b) => a.staffName.localeCompare(b.staffName) || a.staffId.localeCompare(b.staffId));
    const tripCount = await tx.tankSession.count({ where });
    const totalCommissionCents = rows.reduce((sum, row) => sum + row.totalCommissionCents, 0);
    return { startDate, endDate, tripCount, totalCommissionCents, rows };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export type TripPayroll = Awaited<ReturnType<typeof tripPayroll>>;
const headers = ['Employee Name', 'ER Number', 'Total Trips Worked', 'Total Commission Earned'];
export function tripPayrollCsv(report: TripPayroll) {
  const rows = report.rows.map(row => [row.staffName, row.erNumber, row.tripsWorked, (row.totalCommissionCents / 100).toFixed(2)]);
  return '\uFEFF' + [headers, ...rows, ['TOTAL', '', report.rows.reduce((sum, row) => sum + row.tripsWorked, 0), (report.totalCommissionCents / 100).toFixed(2)]].map(row => row.map(csvCell).join(',')).join('\r\n');
}
export async function tripPayrollWorkbook(report: TripPayroll, property: { name: string; currency: string }) {
  const workbook = createReportWorkbook();
  const sheet = workbook.addWorksheet('Payroll & Commission', { views: [{ state: 'frozen', ySplit: 5 }] });
  sheet.columns = [{ width: 32 }, { width: 18 }, { width: 24 }, { width: 30 }];
  sheet.mergeCells('A1:D1'); sheet.getCell('A1').value = `${property.name} · Trip Payroll & Commission`; sheet.getCell('A1').font = { bold: true, size: 16 }; sheet.getRow(1).height = 40; sheet.getCell('A1').alignment = { vertical: 'middle', wrapText: true };
  sheet.mergeCells('A2:D2'); sheet.getCell('A2').value = `${report.startDate} to ${report.endDate} · ${property.currency}`;
  sheet.mergeCells('A3:D3'); sheet.getCell('A3').value = `${report.tripCount} trips · Staff totals use recorded payouts; drafts and void trips are excluded.`;
  sheet.getRow(3).height = 32; sheet.getCell('A3').alignment = { wrapText: true, vertical: 'middle' };
  sheet.addRow([]); sheet.addRow(headers);
  styleReportHeader(sheet);
  sheet.getRow(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0369A1' } };
  for (const row of report.rows) {
    const line = sheet.addRow([row.staffName, row.erNumber ?? '', row.tripsWorked, row.totalCommissionCents / 100]);
    line.height = Math.max(22, Math.ceil(row.staffName.length / 30) * 15);
    line.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
  }
  const total = sheet.addRow(['TOTAL', '', report.rows.reduce((sum, row) => sum + row.tripsWorked, 0), report.totalCommissionCents / 100]);
  total.font = { bold: true }; total.border = { top: { style: 'thin' } };
  sheet.getColumn(4).numFmt = '#,##0.00';
  sheet.autoFilter = { from: 'A5', to: `D${5 + report.rows.length}` };
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5' };
  return workbook.xlsx.writeBuffer();
}
