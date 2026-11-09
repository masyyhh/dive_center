import { prisma } from '../db';
import { calculateCommissionForPeriod } from './commissionService';
import { createReportWorkbook, styleReportHeader } from './reportWorkbook';

export const generateDailyExcelReport = async (propertyId: string, date: string) => {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error('Property not found');
  const currency = property.currency;

  const bills = await prisma.bill.findMany({
    where: { propertyId, businessDate: date, status: 'ACTIVE' },
    include: { items: true },
    orderBy: { checkNumber: 'asc' },
  });

  const { staffResults, certificationPoolTotal, storeAttendantPoolTotal, unallocatedStoreAttendantPoolTotal } = await calculateCommissionForPeriod(propertyId, date, date);

  const workbook = createReportWorkbook();

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
  styleReportHeader(billSheet, 'FF0284C7');

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
  styleReportHeader(commSheet, 'FF0D9488');

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
  styleReportHeader(poolSheet);
  poolSheet.addRow({ metric: `Certifications Pool (${currency})`, value: certificationPoolTotal.toFixed(2) });
  poolSheet.addRow({ metric: 'Distribution', value: 'No staff commission or base-leader override' });

  if (storeAttendantPoolTotal > 0) {
    const retailSheet = workbook.addWorksheet('Store attendant pool');
    retailSheet.columns = [{ header: 'Metric', key: 'metric', width: 42 }, { header: `Amount (${currency})`, key: 'amount', width: 22 }];
    styleReportHeader(retailSheet);
    retailSheet.addRow({ metric: 'Retail pool (5% after discounts)', amount: storeAttendantPoolTotal });
    retailSheet.addRow({ metric: 'Unallocated (no eligible Store attendants)', amount: unallocatedStoreAttendantPoolTotal });
    retailSheet.getColumn(2).numFmt = '#,##0.00';
  }
  return workbook.xlsx.writeBuffer();
};
