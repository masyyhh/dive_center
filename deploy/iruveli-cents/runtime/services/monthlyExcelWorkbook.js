"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMonthlyExcelWorkbook = void 0;
const commissionReconciliation_1 = require("./commissionReconciliation");
const db_1 = require("../db");
const commissionService_1 = require("./commissionService");
const dates_1 = require("../utils/dates");
const reportWorkbook_1 = require("./reportWorkbook");
const siyamMonthlyWorkbook_1 = require("./siyamMonthlyWorkbook");
const generateMonthlyExcelWorkbook = async (propertyId, yearMonth) => {
    const property = await db_1.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property)
        throw new Error('Property not found');
    const currency = property.currency;
    if (!(0, dates_1.isYearMonth)(yearMonth))
        throw new Error('Choose a valid month (YYYY-MM).');
    const startDate = `${yearMonth}-01`;
    const monthEnd = new Date(`${yearMonth}-01T12:00:00Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    const endDate = monthEnd.toISOString().slice(0, 10);
    const bills = await db_1.prisma.bill.findMany({
        where: {
            propertyId,
            businessDate: { gte: startDate, lte: endDate },
            status: 'ACTIVE',
        },
        include: { items: true },
        orderBy: { businessDate: 'asc' },
    });
    const { staffResults, personalDetails, certificationPoolTotal, unallocatedStoreAttendantPoolTotal, unallocatedCommissions } = await (0, commissionService_1.calculateCommissionForPeriod)(propertyId, startDate, endDate);
    const attendances = await db_1.prisma.attendance.findMany({
        where: {
            propertyId,
            staffMember: { propertyId },
            date: { gte: startDate, lte: endDate },
        },
        include: { staffMember: true },
        orderBy: { date: 'asc' },
    });
    // Match the full property name, consistently with the Siyam-only billing UI.
    if (/^(sun\s+)?siyam\s+world$/i.test(property.name.trim())) {
        const staff = await db_1.prisma.staffMember.findMany({
            where: { propertyId, hireDate: { lte: endDate }, OR: [{ leavingDate: null }, { leavingDate: { gte: startDate } }] },
            orderBy: { name: 'asc' },
        });
        return (0, siyamMonthlyWorkbook_1.createSiyamMonthlyWorkbook)({ property, yearMonth, bills, staff, attendances, staffResults, personalDetails, certificationPoolTotal, unallocatedStoreAttendantPoolTotal }).xlsx.writeBuffer();
    }
    const workbook = (0, reportWorkbook_1.createReportWorkbook)();
    // Sheet 1: Month Overview
    const summarySheet = workbook.addWorksheet('Overview');
    summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 25 },
    ];
    (0, reportWorkbook_1.styleReportHeader)(summarySheet);
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
    (0, reportWorkbook_1.styleReportHeader)(commSheet, 'FF1E293B');
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
    (0, reportWorkbook_1.styleReportHeader)(personalSheet);
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
    (0, reportWorkbook_1.styleReportHeader)(attSheet);
    for (const a of attendances) {
        attSheet.addRow({
            date: a.date,
            name: a.staffMember.name,
            status: a.status,
        });
    }
    (0, commissionReconciliation_1.addUnallocatedCommissionSheet)(workbook, unallocatedCommissions, currency);
    return workbook.xlsx.writeBuffer();
};
exports.generateMonthlyExcelWorkbook = generateMonthlyExcelWorkbook;
