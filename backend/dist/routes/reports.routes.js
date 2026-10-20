"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const commissionService_1 = require("../services/commissionService");
const excelService_1 = require("../services/excelService");
const auditService_1 = require("../services/auditService");
exports.reportsRouter = (0, express_1.Router)();
// GET /api/reports/dashboard?propertyId=...&startDate=...&endDate=...
exports.reportsRouter.get('/dashboard', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate are required.' });
        }
        const propId = String(propertyId);
        const start = String(startDate);
        const end = String(endDate);
        const property = await db_1.prisma.property.findUnique({ where: { id: propId } });
        if (!property)
            return res.status(404).json({ error: 'Property not found.' });
        // Fetch active bills in period
        const bills = await db_1.prisma.bill.findMany({
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
        const locks = await db_1.prisma.monthLock.findMany({
            where: {
                propertyId: propId,
                yearMonth: { in: [startYm, endYm] },
                isLocked: true,
            },
        });
        const isLocked = locks.length > 0;
        // Calculate Commissions
        const { staffResults, personalDetails, grandTotal: totalCommission } = await (0, commissionService_1.calculateCommissionForPeriod)(propId, start, end);
        // Headline metrics
        let turnover = 0; // Gross
        let totalDiscount = 0;
        let totalServiceCharge = 0;
        let totalTax = 0;
        let totalTips = 0;
        let netRevenue = 0;
        const categoryMap = new Map();
        const nationalityMap = new Map();
        const itemMap = new Map();
        const weekdayMap = new Map([
            ['Sunday', 0],
            ['Monday', 0],
            ['Tuesday', 0],
            ['Wednesday', 0],
            ['Thursday', 0],
            ['Friday', 0],
            ['Saturday', 0],
        ]);
        const dailyMap = new Map();
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
                netRevenue: Math.round(netRevenue * 100) / 100,
            },
            charts,
            staffCommissions: staffResults,
            personalDetails,
        });
    }
    catch (error) {
        console.error('Fetch reporting error:', error);
        return res.status(500).json({ error: 'Failed to generate reports.' });
    }
});
// POST /api/reports/recompute
// PDF Page 6: "The Recompute commission button forces a recalculation if you want to confirm the figures."
exports.reportsRouter.post('/recompute', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('body', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, startDate, endDate } = req.body;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate are required.' });
        }
        // Check if month is locked
        const ym = String(startDate).substring(0, 7);
        const lock = await db_1.prisma.monthLock.findUnique({
            where: { propertyId_yearMonth: { propertyId: String(propertyId), yearMonth: ym } },
        });
        if (lock && lock.isLocked) {
            return res.status(423).json({
                error: `Recompute disabled: Month ${ym} is locked for payroll.`,
            });
        }
        const result = await (0, commissionService_1.calculateCommissionForPeriod)(String(propertyId), String(startDate), String(endDate));
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: String(propertyId),
            action: 'COMMISSION_RECOMPUTE',
            targetType: 'Commission',
            details: { startDate, endDate, totalCommission: result.grandTotal },
        });
        return res.json({ message: 'Commission recomputed successfully.', data: result });
    }
    catch (error) {
        console.error('Recompute error:', error);
        return res.status(500).json({ error: 'Failed to recompute commission.' });
    }
});
// POST /api/reports/month-lock
// PDF Page 6: "A Locked pill on a month means your administrator has frozen it for payroll"
exports.reportsRouter.post('/month-lock', auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), (0, rbac_1.requirePropertyAccess)('body', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, yearMonth, lock } = req.body;
        if (!yearMonth || !/^\d{4}-\d{2}$/.test(String(yearMonth))) {
            return res.status(400).json({ error: 'Valid yearMonth (YYYY-MM) is required.' });
        }
        const shouldLock = lock !== undefined ? Boolean(lock) : true;
        const record = await db_1.prisma.monthLock.upsert({
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
                lockedById: req.user.id,
            },
            update: {
                isLocked: shouldLock,
                lockedAt: new Date(),
                lockedById: req.user.id,
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: String(propertyId),
            action: shouldLock ? 'MONTH_LOCK' : 'MONTH_UNLOCK',
            targetType: 'MonthLock',
            targetId: yearMonth,
            details: { yearMonth, isLocked: shouldLock },
        });
        return res.json({
            message: `Month ${yearMonth} is now ${shouldLock ? 'locked (frozen for payroll)' : 'unlocked'}.`,
            monthLock: record,
        });
    }
    catch (error) {
        console.error('Month lock error:', error);
        return res.status(500).json({ error: 'Failed to update month lock status.' });
    }
});
// GET /api/reports/export/daily?propertyId=...&date=...
// PDF Page 6: Daily report — pick a date, download the day's .xlsx
exports.reportsRouter.get('/export/daily', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, date } = req.query;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
        }
        const buffer = await (0, excelService_1.generateDailyExcelReport)(String(propertyId), String(date));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Daily_Report_${date}.xlsx"`);
        return res.send(buffer);
    }
    catch (error) {
        console.error('Export daily excel error:', error);
        return res.status(500).json({ error: 'Failed to export daily report.' });
    }
});
// GET /api/reports/export/monthly?propertyId=...&yearMonth=...
// PDF Page 6: Monthly report — pick a month and download full workbook .xlsx
exports.reportsRouter.get('/export/monthly', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, yearMonth } = req.query;
        if (!yearMonth || !/^\d{4}-\d{2}$/.test(String(yearMonth))) {
            return res.status(400).json({ error: 'Valid yearMonth (YYYY-MM) is required.' });
        }
        const buffer = await (0, excelService_1.generateMonthlyExcelWorkbook)(String(propertyId), String(yearMonth));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Monthly_Payroll_${yearMonth}.xlsx"`);
        return res.send(buffer);
    }
    catch (error) {
        console.error('Export monthly excel error:', error);
        return res.status(500).json({ error: 'Failed to export monthly workbook.' });
    }
});
