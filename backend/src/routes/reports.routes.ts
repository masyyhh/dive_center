import { withPropertyPayrollTransaction, payrollReply } from '../utils/payrollTransaction';
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { calculateCommissionForPeriod } from '../services/commissionService';
import { generateDailyExcelReport, generateMonthlyExcelWorkbook } from '../services/excelService';
import { logAuditEvent } from '../services/auditService';

import { isBusinessDate, isYearMonth, isDateRange } from '../utils/dates';

export const reportsRouter = Router();

reportsRouter.get('/commission-breakdown', requireAuth, requirePropertyAccess('query'), async (req, res) => {
  const { propertyId, staffId, startDate, endDate } = req.query;
  if (typeof propertyId !== 'string' || !propertyId || typeof staffId !== 'string' || !staffId || !isDateRange(startDate, endDate)) {
    return res.status(400).json({ error: 'Choose a property, employee and valid report period.' });
  }
  try {
    const member = await prisma.staffMember.findFirst({ where: { id: staffId, propertyId, isActive: true }, select: { id: true } });
    if (!member) return res.status(404).json({ error: 'Employee not found for this property.' });
    const result = await calculateCommissionForPeriod(propertyId, String(startDate), String(endDate), staffId);
    const staff = result.staffResults.find(staff => staff.staffId === staffId);
    if (!staff) return res.status(404).json({ error: 'Employee not found for this property.' });
    const details = result.breakdownDetails.sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.checkNumber - b.checkNumber || a.itemName.localeCompare(b.itemName));
    // Match the money formatter used in the UI, including fractional-cent shares.
    const displayedSum = details.reduce((sum, detail) => sum + Number(detail.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })), 0);
    return res.json({ staff, details, roundingAdjustment: Math.round((staff.totalCommission - displayedSum) * 100) / 100,
      period: { startDate, endDate } });
  } catch (error) {
    console.error('Commission breakdown error:', error);
    return res.status(500).json({ error: 'Could not load the payroll breakdown.' });
  }
});

// GET /api/reports/dashboard?propertyId=...&startDate=...&endDate=...
reportsRouter.get('/dashboard', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const { propertyId, startDate, endDate } = req.query;

    if (!isDateRange(startDate, endDate)) {
      return res.status(400).json({ error: 'Valid startDate and endDate are required, with startDate on or before endDate.' });
    }

    const propId = String(propertyId);
    const start = String(startDate);
    const end = String(endDate);

    const property = await prisma.property.findUnique({ where: { id: propId } });
    if (!property) return res.status(404).json({ error: 'Property not found.' });

    // Fetch active bills in period
    const bills = await prisma.bill.findMany({
      where: {
        propertyId: propId,
        businessDate: { gte: start, lte: end },
        status: 'ACTIVE',
      },
      include: {
        items: true,
      },
      orderBy: { businessDate: 'asc' },
    });

    // Check if current period has any locked months
    const startYm = start.substring(0, 7);
    const endYm = end.substring(0, 7);
    const locks = await prisma.monthLock.findMany({
      where: {
        propertyId: propId,
        yearMonth: { gte: startYm, lte: endYm },
        isLocked: true,
      },
    });
    const isLocked = locks.length > 0;

    // Calculate Commissions
    const { staffResults, personalDetails, certificationPoolTotal, grandTotal: totalCommission } =
      await calculateCommissionForPeriod(propId, start, end);

    // Headline metrics
    let turnover = 0; // Gross
    let totalDiscount = 0;
    let totalServiceCharge = 0;
    let totalTax = 0;
    let totalTips = 0;
    let netRevenue = 0;

    const categoryMap = new Map<string, number>();
    const nationalityMap = new Map<string, number>();
    const itemMap = new Map<string, { name: string; count: number; revenue: number }>();
    const weekdayMap = new Map<string, number>([
      ['Sunday', 0],
      ['Monday', 0],
      ['Tuesday', 0],
      ['Wednesday', 0],
      ['Thursday', 0],
      ['Friday', 0],
      ['Saturday', 0],
    ]);
    const dailyMap = new Map<string, { date: string; revenue: number; billsCount: number }>();

    const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const b of bills) {
      turnover += b.grossAmount;
      totalDiscount += b.discountAmount;
      totalServiceCharge += b.serviceChargeAmount;
      totalTax += b.taxAmount;
      totalTips += b.tipAmount;
      netRevenue += b.netAmount;

      // Nationality chart
      const nat = b.nationality || 'Other';
      nationalityMap.set(nat, (nationalityMap.get(nat) || 0) + b.netAmount);

      // Weekday chart
      const d = new Date(b.businessDate);
      const dayName = weekdaysList[d.getUTCDay()];
      if (dayName) {
        weekdayMap.set(dayName, (weekdayMap.get(dayName) || 0) + b.netAmount);
      }

      // Daily trends
      const dayEntry = dailyMap.get(b.businessDate) || { date: b.businessDate, revenue: 0, billsCount: 0 };
      dayEntry.revenue += b.netAmount;
      dayEntry.billsCount += 1;
      dailyMap.set(b.businessDate, dayEntry);

      // Category & Top items
      for (const it of b.items) {
        const cat = it.categoryName || 'General';
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + it.lineTotal);

        const currentIt = itemMap.get(it.itemName) || { name: it.itemName, count: 0, revenue: 0 };
        currentIt.count += it.quantity;
        currentIt.revenue += it.lineTotal;
        itemMap.set(it.itemName, currentIt);
      }
    }

    const billCount = bills.length;
    const averageBill = billCount > 0 ? netRevenue / billCount : 0;

    const charts = {
      categoryRevenue: Array.from(categoryMap.entries()).map(([category, amount]) => ({
        category,
        amount: Math.round(amount * 100) / 100,
      })),
      nationalityRevenue: Array.from(nationalityMap.entries())
        .map(([nationality, amount]) => ({
          nationality,
          amount: Math.round(amount * 100) / 100,
        }))
        .sort((a, b) => b.amount - a.amount),
      topItems: Array.from(itemMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8)
        .map((it) => ({
          name: it.name,
          count: it.count,
          revenue: Math.round(it.revenue * 100) / 100,
        })),
      weekdayRevenue: Array.from(weekdayMap.entries()).map(([day, amount]) => ({
        day,
        amount: Math.round(amount * 100) / 100,
      })),
      dailyTrends: Array.from(dailyMap.values()).map((d) => ({
        ...d,
        revenue: Math.round(d.revenue * 100) / 100,
      })),
    };

    return res.json({
      property: {
        id: property.id,
        name: property.name,
        currency: property.currency,
        currencySymbol: property.currencySymbol,
      },
      period: { startDate: start, endDate: end, isLocked },
      headline: {
        turnover: Math.round(turnover * 100) / 100,
        serviceCharge: Math.round(totalServiceCharge * 100) / 100,
        tax: Math.round(totalTax * 100) / 100,
        billCount,
        averageBill: Math.round(averageBill * 100) / 100,
        totalCommission,
        certificationPoolTotal,
        netRevenue: Math.round(netRevenue * 100) / 100,
      },
      charts,
      staffCommissions: staffResults,
      personalDetails,
    });
  } catch (error) {
    console.error('Fetch reporting error:', error);
    return res.status(500).json({ error: 'Failed to generate reports.' });
  }
});

// POST /api/reports/recompute
// PDF Page 6: "The Recompute commission button forces a recalculation if you want to confirm the figures."
reportsRouter.post('/recompute', requireAuth, requirePropertyAccess('body', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const { propertyId, startDate, endDate } = req.body;
    if (!isDateRange(startDate, endDate)) {
      return res.status(400).json({ error: 'Valid startDate and endDate are required, with startDate on or before endDate.' });
    }

    // Every month intersecting the selected period must be unlocked.
    const locks = await prisma.monthLock.findMany({
      where: {
        propertyId: String(propertyId),
        yearMonth: { gte: String(startDate).slice(0, 7), lte: String(endDate).slice(0, 7) },
        isLocked: true,
      },
    });

    if (locks.length > 0) {
      return res.status(423).json({
        error: `Recompute disabled: Month ${locks[0].yearMonth} is locked for payroll.`,
      });
    }

    const result = await calculateCommissionForPeriod(String(propertyId), String(startDate), String(endDate));

    await logAuditEvent({
      client: prisma,
      req,
      propertyId: String(propertyId),
      action: 'COMMISSION_RECOMPUTE',
      targetType: 'Commission',
      details: { startDate, endDate, totalCommission: result.grandTotal },
    });

    return res.json({ message: 'Commission recomputed successfully.', data: result });
  } catch (error) {
    console.error('Recompute error:', error);
    return res.status(500).json({ error: 'Failed to recompute commission.' });
  }
});

// POST /api/reports/month-lock
// PDF Page 6: "A Locked pill on a month means your administrator has frozen it for payroll"
reportsRouter.post(
  '/month-lock',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  requirePropertyAccess('body', 'propertyId'),
  async (req: Request, res: Response) => {
    try {
      const { propertyId, yearMonth, lock } = req.body;
      if (!isYearMonth(yearMonth)) {
        return res.status(400).json({ error: 'Valid yearMonth (YYYY-MM) is required.' });
      }

      const result = await withPropertyPayrollTransaction(prisma, String(propertyId), async prisma => {
        const shouldLock = lock !== undefined ? Boolean(lock) : true;

        const record = await prisma.monthLock.upsert({
          where: {
            propertyId_yearMonth: {
              propertyId: String(propertyId),
              yearMonth: String(yearMonth),
            },
          },
          create: {
            propertyId: String(propertyId),
            yearMonth: String(yearMonth),
            isLocked: shouldLock,
            lockedById: req.user!.id,
          },
          update: {
            isLocked: shouldLock,
            lockedAt: new Date(),
            lockedById: req.user!.id,
          },
        });

        await logAuditEvent({
          client: prisma,
          req,
          propertyId: String(propertyId),
          action: shouldLock ? 'MONTH_LOCK' : 'MONTH_UNLOCK',
          targetType: 'MonthLock',
          targetId: yearMonth,
          details: { yearMonth, isLocked: shouldLock },
        });

        return payrollReply(200, {
          message: `Month ${yearMonth} is now ${shouldLock ? 'locked (frozen for payroll)' : 'unlocked'}.`,
          monthLock: record,
        });
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error('Month lock error:', error);
      return res.status(500).json({ error: 'Failed to update month lock status.' });
    }
  }
);

// GET /api/reports/export/daily?propertyId=...&date=...
// PDF Page 6: Daily report — pick a date, download the day's .xlsx
reportsRouter.get('/export/daily', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const { propertyId, date } = req.query;
    if (!isBusinessDate(date)) {
      return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
    }

    const buffer = await generateDailyExcelReport(String(propertyId), String(date));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="Daily_Report_${date}.xlsx"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Export daily excel error:', error);
    return res.status(500).json({ error: 'Failed to export daily report.' });
  }
});

// GET /api/reports/export/monthly?propertyId=...&yearMonth=...
// PDF Page 6: Monthly report — pick a month and download full workbook .xlsx
reportsRouter.get('/export/monthly', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const { propertyId, yearMonth } = req.query;
    if (!isYearMonth(yearMonth)) {
      return res.status(400).json({ error: 'Valid yearMonth (YYYY-MM) is required.' });
    }

    const buffer = await generateMonthlyExcelWorkbook(String(propertyId), String(yearMonth));

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="Monthly_Payroll_${yearMonth}.xlsx"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Export monthly excel error:', error);
    return res.status(500).json({ error: 'Failed to export monthly workbook.' });
  }
});
