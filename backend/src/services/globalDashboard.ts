import { prisma } from '../db';
import { businessToday } from '../utils/dates';
import { calculateCommissionForPeriod } from './commissionService';

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

export async function globalDashboard(startDate: string, endDate: string) {
  const properties = await prisma.property.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  const ids = properties.map(property => property.id);
  const [billTotals, staff, attendance] = await Promise.all([
    prisma.bill.groupBy({ by: ['propertyId'], where: { propertyId: { in: ids }, status: 'ACTIVE', businessDate: { gte: startDate, lte: endDate } },
      _sum: { grossAmount: true, discountAmount: true }, _count: { _all: true } }),
    prisma.staffMember.findMany({ where: { propertyId: { in: ids }, isActive: true, isDiveStaff: true, hireDate: { lte: endDate }, OR: [{ leavingDate: null }, { leavingDate: { gte: startDate } }] },
      select: { id: true, propertyId: true, hireDate: true, leavingDate: true } }),
    prisma.attendance.findMany({ where: { propertyId: { in: ids }, date: { gte: startDate, lte: endDate, lt: businessToday() } }, select: { propertyId: true, staffMemberId: true, date: true } }),
  ]);
  const totals = new Map(billTotals.map(total => [total.propertyId, total]));
  const marked = new Set(attendance.map(record => JSON.stringify([record.propertyId, record.staffMemberId, record.date])));
  const staffByProperty = new Map<string, typeof staff>();
  for (const member of staff) {
    const members = staffByProperty.get(member.propertyId) || [];
    members.push(member); staffByProperty.set(member.propertyId, members);
  }
  const today = businessToday();
  const dates: string[] = [];
  for (let day = new Date(`${startDate}T12:00:00Z`); day.getTime() <= new Date(`${endDate}T12:00:00Z`).getTime(); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (date >= today) break;
    dates.push(date);
  }
  const rows = [];
  // Bound payroll work per request rather than opening one database workload per property at once.
  for (const property of properties) {
    const financials = totals.get(property.id);
    let missingAttendance = 0;
    let missingDays = 0;
    let firstMissingDate: string | null = null;
    for (const date of dates) {
      const missing = (staffByProperty.get(property.id) || []).filter(member => member.hireDate <= date && (!member.leavingDate || member.leavingDate >= date) && !marked.has(JSON.stringify([property.id, member.id, date]))).length;
      missingAttendance += missing;
      if (missing) { missingDays++; firstMissingDate ??= date; }
    }
    const commissions = await calculateCommissionForPeriod(property.id, startDate, endDate);
    rows.push({ propertyId: property.id, name: property.name, code: property.code, isActive: property.isActive,
      currency: property.currency, currencySymbol: property.currencySymbol,
      revenue: roundMoney((financials?._sum.grossAmount || 0) - (financials?._sum.discountAmount || 0)),
      discounts: roundMoney(financials?._sum.discountAmount || 0), billCount: financials?._count._all || 0,
      commissions: commissions.grandTotal, missingAttendance, missingDays, firstMissingDate });
  }
  const byCurrency = new Map<string, { currency: string; revenue: number; discounts: number; commissions: number; billCount: number }>();
  for (const row of rows) {
    const total = byCurrency.get(row.currency) || { currency: row.currency, revenue: 0, discounts: 0, commissions: 0, billCount: 0 };
    total.revenue += row.revenue; total.discounts += row.discounts; total.commissions += row.commissions; total.billCount += row.billCount;
    byCurrency.set(row.currency, total);
  }
  return { period: { startDate, endDate, attendanceBefore: today }, properties: rows,
    totals: { propertyCount: rows.length, missingAttendance: rows.reduce((sum, row) => sum + row.missingAttendance, 0),
      currencies: [...byCurrency.values()].map(total => ({ ...total, revenue: roundMoney(total.revenue), discounts: roundMoney(total.discounts), commissions: roundMoney(total.commissions) })) } };
}
