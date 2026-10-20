"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMonthlyExcelWorkbook = exports.generateDailyExcelReport = void 0;
const exceljs_1 = __importDefault(require("exceljs"));
const db_1 = require("../db");
const commissionService_1 = require("./commissionService");
const generateDailyExcelReport = async (propertyId, date) => {
    const property = await db_1.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property)
        throw new Error('Property not found');
    const bills = await db_1.prisma.bill.findMany({
        where: { propertyId, businessDate: date, status: 'ACTIVE' },
        include: { items: true },
        orderBy: { checkNumber: 'asc' },
    });
    const { staffResults } = await (0, commissionService_1.calculateCommissionForPeriod)(propertyId, date, date);
    const workbook = new exceljs_1.default.Workbook();
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
        { header: 'Gross ($)', key: 'gross', width: 14 },
        { header: 'Discount ($)', key: 'discount', width: 14 },
        { header: 'Service Charge ($)', key: 'sc', width: 18 },
        { header: 'Tax ($)', key: 'tax', width: 14 },
        { header: 'Tip ($)', key: 'tip', width: 14 },
        { header: 'Net Total ($)', key: 'net', width: 16 },
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
    let totalSc = 0;
    let totalTax = 0;
    let totalTip = 0;
    for (const b of bills) {
        totalGross += b.grossAmount;
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
        { header: 'Course Pool ($)', key: 'courseCommission', width: 16 },
        { header: 'Dive Pool ($)', key: 'diveCommission', width: 16 },
        { header: 'Base Leader Override ($)', key: 'overrideCommission', width: 24 },
        { header: 'Tips ($)', key: 'tipsCommission', width: 14 },
        { header: 'Personal ($)', key: 'personalCommission', width: 16 },
        { header: 'Total Pay ($)', key: 'totalCommission', width: 16 },
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
    return workbook.xlsx.writeBuffer();
};
exports.generateDailyExcelReport = generateDailyExcelReport;
const generateMonthlyExcelWorkbook = async (propertyId, yearMonth) => {
    const property = await db_1.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property)
        throw new Error('Property not found');
    const startDate = `${yearMonth}-01`;
    const endDate = `${yearMonth}-31`;
    const bills = await db_1.prisma.bill.findMany({
        where: {
            propertyId,
            businessDate: { gte: startDate, lte: endDate },
            status: 'ACTIVE',
        },
        include: { items: true },
        orderBy: { businessDate: 'asc' },
    });
    const { staffResults, personalDetails } = await (0, commissionService_1.calculateCommissionForPeriod)(propertyId, startDate, endDate);
    const attendances = await db_1.prisma.attendance.findMany({
        where: {
            propertyId,
            date: { gte: startDate, lte: endDate },
        },
        include: { staffMember: true },
        orderBy: { date: 'asc' },
    });
    const workbook = new exceljs_1.default.Workbook();
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
    summarySheet.addRow({ metric: 'Turnover (Gross)', value: `$${turnover.toFixed(2)}` });
    summarySheet.addRow({ metric: 'Service Charge (10%)', value: `$${totalSc.toFixed(2)}` });
    summarySheet.addRow({ metric: 'Tax (16%)', value: `$${totalTax.toFixed(2)}` });
    summarySheet.addRow({ metric: 'Total Tips Paid', value: `$${totalTips.toFixed(2)}` });
    summarySheet.addRow({ metric: 'Net Revenue', value: `$${totalNet.toFixed(2)}` });
    summarySheet.addRow({ metric: 'Total Staff Commission', value: `$${totalCommission.toFixed(2)}` });
    // Sheet 2: Staff Commission
    const commSheet = workbook.addWorksheet('Staff Commission Breakdown');
    commSheet.columns = [
        { header: 'Staff Name', key: 'name', width: 24 },
        { header: 'Role', key: 'role', width: 20 },
        { header: 'Course Pool ($)', key: 'course', width: 16 },
        { header: 'Dive Pool ($)', key: 'dive', width: 16 },
        { header: 'Base Leader Override ($)', key: 'override', width: 22 },
        { header: 'Tips ($)', key: 'tips', width: 14 },
        { header: 'Personal ($)', key: 'personal', width: 16 },
        { header: 'Total Pay ($)', key: 'total', width: 16 },
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
        { header: 'Amount ($)', key: 'amount', width: 14 },
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
exports.generateMonthlyExcelWorkbook = generateMonthlyExcelWorkbook;
