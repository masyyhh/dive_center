import ExcelJS from 'exceljs';
import { prisma } from '../db';
import { calculateCommissionForPeriod } from './commissionService';
import { isYearMonth } from '../utils/dates';

export const generateDailyExcelReport = async (propertyId: string, date: string) => {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error('Property not found');
  const currency = property.currency;

  const bills = await prisma.bill.findMany({
    where: { propertyId, businessDate: date, status: 'ACTIVE' },
    include: { items: true },
    orderBy: { checkNumber: 'asc' },
  });

  const { staffResults, certificationPoolTotal } = await calculateCommissionForPeriod(propertyId, date, date);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dive Centre Manager';
  workbook.created = new Date();

  // Sheet 1: Daily Bills
  const billSheet = workbook.addWorksheet('Bills');
  billSheet.columns = [
    { header: 'Check #', key: 'checkNumber', width: 12 },
    { header: 'Room #', key: 'roomNumber', width: 12 },
    { header: 'Guest Name', key: 'guestName', width: 25 },
    { header: 'Nationality', key: 'nationality', width: 18 },
    { header: 'Items Count', key: 'itemsCount', width: 14 },
    { header: `Gross (${currency})`, key: 'gross', width: 14 },
    { header: `Discount (${currency})`, key: 'discount', width: 14 },
    { header: `Service Charge (${currency})`, key: 'sc', width: 18 },
    { header: `Tax (${currency})`, key: 'tax', width: 14 },
    { header: `Tip (${currency})`, key: 'tip', width: 14 },
    { header: `Net Total (${currency})`, key: 'net', width: 16 },
  ];

  // Header style
  billSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  billSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0284C7' }, // Sky-600
  };

  let totalGross = 0;
  let totalNet = 0;
  let totalDiscount = 0;
  let totalSc = 0;
  let totalTax = 0;
  let totalTip = 0;

  for (const b of bills) {
    totalGross += b.grossAmount;
    totalDiscount += b.discountAmount;
    totalNet += b.netAmount;
    totalSc += b.serviceChargeAmount;
    totalTax += b.taxAmount;
    totalTip += b.tipAmount;

    billSheet.addRow({
      checkNumber: b.checkNumber,
      roomNumber: b.roomNumber,
      guestName: b.guestName,
      nationality: b.nationality,
      itemsCount: b.items.length,
      gross: b.grossAmount.toFixed(2),
      discount: b.discountAmount.toFixed(2),
      sc: b.serviceChargeAmount.toFixed(2),
      tax: b.taxAmount.toFixed(2),
      tip: b.tipAmount.toFixed(2),
      net: b.netAmount.toFixed(2),
    });
  }

  // Summary Row
  const sumRow = billSheet.addRow({
    checkNumber: 'TOTAL',
    itemsCount: bills.length,
    gross: totalGross.toFixed(2),
    discount: totalDiscount.toFixed(2),
    sc: totalSc.toFixed(2),
    tax: totalTax.toFixed(2),
    tip: totalTip.toFixed(2),
    net: totalNet.toFixed(2),
  });
  sumRow.font = { bold: true };

  // Sheet 2: Staff Commission
  const commSheet = workbook.addWorksheet('Staff Commission');
  commSheet.columns = [
    { header: 'Staff Member', key: 'staffName', width: 25 },
    { header: 'Role', key: 'roleTitle', width: 20 },
    { header: `Course Pool (${currency})`, key: 'courseCommission', width: 16 },
    { header: `Dive Pool (${currency})`, key: 'diveCommission', width: 16 },
    { header: `Base Leader Override (${currency})`, key: 'overrideCommission', width: 24 },
    { header: `Tips (${currency})`, key: 'tipsCommission', width: 14 },
    { header: `Personal (${currency})`, key: 'personalCommission', width: 16 },
    { header: `Total Pay (${currency})`, key: 'totalCommission', width: 16 },
  ];
  commSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  commSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0D9488' }, // Teal-600
  };

  for (const c of staffResults) {
    commSheet.addRow({
      staffName: c.staffName,
      roleTitle: c.roleTitle,
      courseCommission: c.courseCommission.toFixed(2),
      diveCommission: c.diveCommission.toFixed(2),
      overrideCommission: c.overrideCommission.toFixed(2),
      tipsCommission: c.tipsCommission.toFixed(2),
      personalCommission: c.personalCommission.toFixed(2),
      totalCommission: c.totalCommission.toFixed(2),
    });
  }

  const poolSheet = workbook.addWorksheet('Certifications Pool');
  poolSheet.columns = [{ header: 'Metric', key: 'metric', width: 36 }, { header: 'Value', key: 'value', width: 45 }];
  poolSheet.getRow(1).font = { bold: true };
  poolSheet.addRow({ metric: `Certifications Pool (${currency})`, value: certificationPoolTotal.toFixed(2) });
  poolSheet.addRow({ metric: 'Distribution', value: 'No staff commission or base-leader override' });

  return workbook.xlsx.writeBuffer();
};

export const generateMonthlyExcelWorkbook = async (propertyId: string, yearMonth: string) => {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error('Property not found');
  const currency = property.currency;

  if (!isYearMonth(yearMonth)) throw new Error('Choose a valid month (YYYY-MM).');
  const startDate = `${yearMonth}-01`;
  const monthEnd = new Date(`${yearMonth}-01T12:00:00Z`);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  const endDate = monthEnd.toISOString().slice(0, 10);

  const bills = await prisma.bill.findMany({
    where: {
      propertyId,
      businessDate: { gte: startDate, lte: endDate },
      status: 'ACTIVE',
    },
    include: { items: true },
    orderBy: { businessDate: 'asc' },
  });

  const { staffResults, personalDetails, certificationPoolTotal } = await calculateCommissionForPeriod(
    propertyId,
    startDate,
    endDate
  );

  const attendances = await prisma.attendance.findMany({
    where: {
      propertyId,
      staffMember: { propertyId },
      date: { gte: startDate, lte: endDate },
    },
    include: { staffMember: true },
    orderBy: { date: 'asc' },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dive Centre Manager';
  workbook.created = new Date();

  // Sheet 1: Month Overview
  const summarySheet = workbook.addWorksheet('Overview');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 25 },
  ];
  summarySheet.getRow(1).font = { bold: true };

  const turnover = bills.reduce((acc, b) => acc + b.grossAmount, 0);
  const totalSc = bills.reduce((acc, b) => acc + b.serviceChargeAmount, 0);
  const totalTax = bills.reduce((acc, b) => acc + b.taxAmount, 0);
  const totalNet = bills.reduce((acc, b) => acc + b.netAmount, 0);
  const totalTips = bills.reduce((acc, b) => acc + b.tipAmount, 0);
  const totalCommission = staffResults.reduce((acc, s) => acc + s.totalCommission, 0);

  summarySheet.addRow({ metric: 'Property', value: property.name });
  summarySheet.addRow({ metric: 'Month', value: yearMonth });
  summarySheet.addRow({ metric: 'Total Active Bills', value: bills.length });
  summarySheet.addRow({ metric: 'Turnover (Gross)', value: `${currency} ${turnover.toFixed(2)}` });
  summarySheet.addRow({ metric: 'Service Charge', value: `${currency} ${totalSc.toFixed(2)}` });
  summarySheet.addRow({ metric: 'Tax', value: `${currency} ${totalTax.toFixed(2)}` });
  summarySheet.addRow({ metric: 'Total Tips Paid', value: `${currency} ${totalTips.toFixed(2)}` });
  summarySheet.addRow({ metric: 'Net Revenue', value: `${currency} ${totalNet.toFixed(2)}` });
  summarySheet.addRow({ metric: 'Total Staff Commission', value: `${currency} ${totalCommission.toFixed(2)}` });
  summarySheet.addRow({ metric: 'Certifications Pool (not paid to staff)', value: `${currency} ${certificationPoolTotal.toFixed(2)}` });

  // Sheet 2: Staff Commission
  const commSheet = workbook.addWorksheet('Staff Commission Breakdown');
  commSheet.columns = [
    { header: 'Staff Name', key: 'name', width: 24 },
    { header: 'Role', key: 'role', width: 20 },
    { header: `Course Pool (${currency})`, key: 'course', width: 16 },
    { header: `Dive Pool (${currency})`, key: 'dive', width: 16 },
    { header: `Base Leader Override (${currency})`, key: 'override', width: 22 },
    { header: `Tips (${currency})`, key: 'tips', width: 14 },
    { header: `Personal (${currency})`, key: 'personal', width: 16 },
    { header: `Total Pay (${currency})`, key: 'total', width: 16 },
  ];
  commSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  commSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };

  for (const s of staffResults) {
    commSheet.addRow({
      name: s.staffName,
      role: s.roleTitle,
      course: s.courseCommission.toFixed(2),
      dive: s.diveCommission.toFixed(2),
      override: s.overrideCommission.toFixed(2),
      tips: s.tipsCommission.toFixed(2),
      personal: s.personalCommission.toFixed(2),
      total: s.totalCommission.toFixed(2),
    });
  }

  // Sheet 3: Who Did What Personal Commissions
  const personalSheet = workbook.addWorksheet('Personal Commission Details');
  personalSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Check #', key: 'check', width: 12 },
    { header: 'Room #', key: 'room', width: 12 },
    { header: 'Guest Name', key: 'guest', width: 24 },
    { header: 'Item / Activity', key: 'item', width: 30 },
    { header: 'Role', key: 'role', width: 14 },
    { header: 'Staff Member', key: 'staff', width: 24 },
    { header: `Amount (${currency})`, key: 'amount', width: 14 },
  ];
  personalSheet.getRow(1).font = { bold: true };
  for (const p of personalDetails) {
    personalSheet.addRow({
      date: p.businessDate,
      check: p.checkNumber,
      room: p.roomNumber,
      guest: p.guestName,
      item: p.itemName,
      role: p.role,
      staff: p.staffName,
      amount: p.amount.toFixed(2),
    });
  }

  // Sheet 4: Attendance Register
  const attSheet = workbook.addWorksheet('Attendance Register');
  attSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Staff Member', key: 'name', width: 24 },
    { header: 'Status', key: 'status', width: 16 },
  ];
  attSheet.getRow(1).font = { bold: true };
  for (const a of attendances) {
    attSheet.addRow({
      date: a.date,
      name: a.staffMember.name,
      status: a.status,
    });
  }

  return workbook.xlsx.writeBuffer();
};
