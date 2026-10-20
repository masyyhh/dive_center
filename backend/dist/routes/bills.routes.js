"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const auditService_1 = require("../services/auditService");
exports.billsRouter = (0, express_1.Router)();
// Helper to check if a month is locked for a property
const isMonthLocked = async (propertyId, dateStr) => {
    const yearMonth = dateStr.substring(0, 7); // "YYYY-MM"
    const lock = await db_1.prisma.monthLock.findUnique({
        where: {
            propertyId_yearMonth: {
                propertyId,
                yearMonth,
            },
        },
    });
    return lock ? lock.isLocked : false;
};
// GET /api/bills/next-check?propertyId=...
exports.billsRouter.get('/next-check', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const propertyId = String(req.query.propertyId);
        const property = await db_1.prisma.property.findUnique({ where: { id: propertyId } });
        if (!property)
            return res.status(404).json({ error: 'Property not found.' });
        // Find highest check number used by active or rebated bills
        const lastBill = await db_1.prisma.bill.findFirst({
            where: {
                propertyId,
                status: { in: ['ACTIVE', 'REBATED'] },
            },
            orderBy: { checkNumber: 'desc' },
            select: { checkNumber: true },
        });
        const nextNumber = lastBill ? lastBill.checkNumber + 1 : property.nextCheckNumber;
        return res.json({ nextCheckNumber: nextNumber });
    }
    catch (error) {
        console.error('Fetch next check error:', error);
        return res.status(500).json({ error: 'Failed to calculate next check number.' });
    }
});
// GET /api/bills/room-lookup?propertyId=...&roomNumber=...
// PDF Page 4: "If a bill already exists for that room today, typing the room number offers to fill in the guest details from it."
exports.billsRouter.get('/room-lookup', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, roomNumber } = req.query;
        if (!roomNumber)
            return res.json({ found: false });
        const today = new Date().toISOString().substring(0, 10);
        const match = await db_1.prisma.bill.findFirst({
            where: {
                propertyId: String(propertyId),
                roomNumber: String(roomNumber).trim(),
                businessDate: today,
                status: 'ACTIVE',
            },
            orderBy: { createdAt: 'desc' },
            select: {
                guestName: true,
                roomNumber: true,
                departureDate: true,
                nationality: true,
                businessDate: true,
            },
        });
        if (match) {
            return res.json({ found: true, guest: match });
        }
        // Also fallback to any recent bill for that room
        const recentMatch = await db_1.prisma.bill.findFirst({
            where: {
                propertyId: String(propertyId),
                roomNumber: String(roomNumber).trim(),
                status: 'ACTIVE',
            },
            orderBy: { createdAt: 'desc' },
            select: {
                guestName: true,
                roomNumber: true,
                departureDate: true,
                nationality: true,
                businessDate: true,
            },
        });
        if (recentMatch) {
            return res.json({ found: true, guest: recentMatch, isRecent: true });
        }
        return res.json({ found: false });
    }
    catch (error) {
        console.error('Room lookup error:', error);
        return res.status(500).json({ error: 'Failed to lookup room.' });
    }
});
// GET /api/bills?propertyId=...&startDate=...&endDate=...&search=...
exports.billsRouter.get('/', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, startDate, endDate, search, status } = req.query;
        const where = {
            propertyId: String(propertyId),
        };
        if (status && typeof status === 'string' && status !== 'ALL') {
            where.status = status;
        }
        if (startDate && typeof startDate === 'string') {
            where.businessDate = { ...(where.businessDate || {}), gte: startDate };
        }
        if (endDate && typeof endDate === 'string') {
            where.businessDate = { ...(where.businessDate || {}), lte: endDate };
        }
        let bills = await db_1.prisma.bill.findMany({
            where,
            include: {
                createdBy: { select: { id: true, name: true } },
                items: true,
            },
            orderBy: [{ businessDate: 'desc' }, { checkNumber: 'desc' }],
        });
        if (search && typeof search === 'string') {
            const q = search.toLowerCase();
            bills = bills.filter((b) => b.guestName.toLowerCase().includes(q) ||
                b.roomNumber.toLowerCase().includes(q) ||
                String(b.checkNumber).includes(q) ||
                b.nationality.toLowerCase().includes(q));
        }
        return res.json({ bills });
    }
    catch (error) {
        console.error('Fetch bills error:', error);
        return res.status(500).json({ error: 'Failed to fetch bills.' });
    }
});
// GET /api/bills/:id
exports.billsRouter.get('/:id', auth_1.requireAuth, async (req, res) => {
    try {
        const id = String(req.params.id);
        const bill = await db_1.prisma.bill.findUnique({
            where: { id },
            include: {
                createdBy: { select: { id: true, name: true } },
                items: {
                    include: {
                        sellerStaff: { select: { id: true, name: true } },
                        guideStaff: { select: { id: true, name: true } },
                        instructorStaff: { select: { id: true, name: true } },
                        photoStaff: { select: { id: true, name: true } },
                        videoStaff: { select: { id: true, name: true } },
                    },
                },
            },
        });
        if (!bill)
            return res.status(404).json({ error: 'Bill not found.' });
        if (req.user.role !== 'GLOBAL_ADMIN' && !req.user.assignedPropertyIds.includes(bill.propertyId)) {
            return res.status(403).json({ error: 'Unauthorized to view this bill.' });
        }
        return res.json({ bill });
    }
    catch (error) {
        console.error('Get bill details error:', error);
        return res.status(500).json({ error: 'Failed to retrieve bill.' });
    }
});
const billItemSchema = zod_1.z.object({
    itemId: zod_1.z.string().optional().nullable(),
    itemName: zod_1.z.string(),
    categoryName: zod_1.z.string(),
    quantity: zod_1.z.number().int().positive(),
    unitPrice: zod_1.z.number().min(0),
    discountPercent: zod_1.z.number().min(0).max(100).default(0),
    sellerStaffId: zod_1.z.string().optional().nullable(),
    guideStaffId: zod_1.z.string().optional().nullable(),
    instructorStaffId: zod_1.z.string().optional().nullable(),
    photoStaffId: zod_1.z.string().optional().nullable(),
    videoStaffId: zod_1.z.string().optional().nullable(),
    personalCommissionsJson: zod_1.z.string().optional().nullable(),
    totalPersonalCommission: zod_1.z.number().min(0).default(0),
});
const createBillSchema = zod_1.z.object({
    propertyId: zod_1.z.string(),
    checkNumber: zod_1.z.number().int().positive(),
    businessDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    guestName: zod_1.z.string().min(1, 'Guest name is required'),
    roomNumber: zod_1.z.string().min(1, 'Room number is required'),
    departureDate: zod_1.z.string().optional().nullable(),
    nationality: zod_1.z.string().default('Other'),
    tipAmount: zod_1.z.number().min(0).default(0),
    tipStaffIds: zod_1.z.array(zod_1.z.string()).optional().default([]),
    items: zod_1.z.array(billItemSchema).min(1, 'At least one item is required on a bill'),
    notes: zod_1.z.string().optional().nullable(),
});
// POST /api/bills (Create new bill)
exports.billsRouter.post('/', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('body', 'propertyId'), async (req, res) => {
    try {
        const parseResult = createBillSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
        }
        const data = parseResult.data;
        // Check if month is locked
        if (await isMonthLocked(data.propertyId, data.businessDate)) {
            return res.status(423).json({
                error: `Cannot create bill: The month (${data.businessDate.substring(0, 7)}) is locked for payroll.`,
            });
        }
        // PDF Page 3: "Numbers are unique to your centre: if you enter one a current bill already uses, the app stops the save and tells you."
        const existingCheck = await db_1.prisma.bill.findFirst({
            where: {
                propertyId: data.propertyId,
                checkNumber: data.checkNumber,
                status: { in: ['ACTIVE', 'REBATED'] }, // Only active or rebated hold the check number; soft deleted release it
            },
        });
        if (existingCheck) {
            return res.status(400).json({
                error: `Check number #${data.checkNumber} is already in use by another bill in this centre. Please change the check number before saving.`,
            });
        }
        const property = await db_1.prisma.property.findUnique({ where: { id: data.propertyId } });
        if (!property)
            return res.status(404).json({ error: 'Property not found.' });
        // Mathematical calculations per PDF Page 3 & 4:
        // Gross -> - Discount -> + Service charge -> + Tax -> + Tip -> Net
        let grossAmount = 0;
        let totalDiscount = 0;
        const lineItemsData = data.items.map((line) => {
            const lineGross = line.unitPrice * line.quantity;
            const discount = (lineGross * line.discountPercent) / 100;
            const lineTotal = lineGross - discount;
            grossAmount += lineGross;
            totalDiscount += discount;
            return {
                itemId: line.itemId || null,
                itemName: line.itemName,
                categoryName: line.categoryName,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountPercent: line.discountPercent,
                lineTotal,
                sellerStaffId: line.sellerStaffId || null,
                guideStaffId: line.guideStaffId || null,
                instructorStaffId: line.instructorStaffId || null,
                photoStaffId: line.photoStaffId || null,
                videoStaffId: line.videoStaffId || null,
                personalCommissionsJson: line.personalCommissionsJson || null,
                totalPersonalCommission: line.totalPersonalCommission || 0,
            };
        });
        const netBeforeCharges = grossAmount - totalDiscount;
        const serviceChargeAmount = (netBeforeCharges * property.serviceChargeRate) / 100;
        const taxAmount = ((netBeforeCharges + serviceChargeAmount) * property.taxRate) / 100;
        const tipAmount = data.tipAmount || 0;
        const netAmount = netBeforeCharges + serviceChargeAmount + taxAmount + tipAmount;
        const bill = await db_1.prisma.bill.create({
            data: {
                propertyId: data.propertyId,
                checkNumber: data.checkNumber,
                businessDate: data.businessDate,
                guestName: data.guestName,
                roomNumber: data.roomNumber,
                departureDate: data.departureDate || null,
                nationality: data.nationality,
                grossAmount: Math.round(grossAmount * 100) / 100,
                discountAmount: Math.round(totalDiscount * 100) / 100,
                serviceChargeAmount: Math.round(serviceChargeAmount * 100) / 100,
                taxAmount: Math.round(taxAmount * 100) / 100,
                tipAmount: Math.round(tipAmount * 100) / 100,
                netAmount: Math.round(netAmount * 100) / 100,
                tipStaffIdsJson: data.tipStaffIds.length > 0 ? JSON.stringify(data.tipStaffIds) : null,
                status: 'ACTIVE',
                notes: data.notes || null,
                createdById: req.user.id,
                items: {
                    create: lineItemsData,
                },
            },
            include: {
                items: true,
            },
        });
        // Update next check number on property if this check is higher
        if (data.checkNumber >= property.nextCheckNumber) {
            await db_1.prisma.property.update({
                where: { id: property.id },
                data: { nextCheckNumber: data.checkNumber + 1 },
            });
        }
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: bill.propertyId,
            action: 'BILL_CREATE',
            targetType: 'Bill',
            targetId: bill.id,
            details: { checkNumber: bill.checkNumber, guest: bill.guestName, net: bill.netAmount },
        });
        return res.status(201).json({ bill });
    }
    catch (error) {
        console.error('Create bill error:', error);
        return res.status(500).json({ error: 'Failed to save bill.' });
    }
});
// POST /api/bills/:id/re-date
// PDF Page 4: "Re-date: Move a bill to a different business date (the number stays the same)."
exports.billsRouter.post('/:id/re-date', auth_1.requireAuth, async (req, res) => {
    try {
        const id = String(req.params.id);
        const { newDate } = req.body;
        if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
            return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
        }
        const bill = await db_1.prisma.bill.findUnique({ where: { id } });
        if (!bill)
            return res.status(404).json({ error: 'Bill not found.' });
        // Property authorization
        if (req.user.role !== 'GLOBAL_ADMIN' && !req.user.assignedPropertyIds.includes(bill.propertyId)) {
            return res.status(403).json({ error: 'Unauthorized for this property.' });
        }
        // Check month locks on old and new dates
        if (await isMonthLocked(bill.propertyId, bill.businessDate)) {
            return res.status(423).json({ error: 'Cannot re-date: Original month is locked for payroll.' });
        }
        if (await isMonthLocked(bill.propertyId, newDate)) {
            return res.status(423).json({ error: 'Cannot re-date: Target month is locked for payroll.' });
        }
        const oldDate = bill.businessDate;
        const updated = await db_1.prisma.bill.update({
            where: { id },
            data: { businessDate: newDate },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: bill.propertyId,
            action: 'BILL_REDATE',
            targetType: 'Bill',
            targetId: bill.id,
            details: { checkNumber: bill.checkNumber, fromDate: oldDate, toDate: newDate },
        });
        return res.json({ bill: updated });
    }
    catch (error) {
        console.error('Re-date bill error:', error);
        return res.status(500).json({ error: 'Failed to re-date bill.' });
    }
});
// POST /api/bills/:id/rebate
// PDF Page 4: "Rebate: Reverse a bill with a linked adjustment. The original stays on record; a rebated bill earns no commission."
exports.billsRouter.post('/:id/rebate', auth_1.requireAuth, async (req, res) => {
    try {
        const id = String(req.params.id);
        const { reason } = req.body;
        if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
            return res.status(400).json({ error: 'A reason for rebate is required.' });
        }
        const bill = await db_1.prisma.bill.findUnique({ where: { id } });
        if (!bill)
            return res.status(404).json({ error: 'Bill not found.' });
        if (bill.status === 'REBATED') {
            return res.status(400).json({ error: 'This bill has already been rebated.' });
        }
        if (req.user.role !== 'GLOBAL_ADMIN' && !req.user.assignedPropertyIds.includes(bill.propertyId)) {
            return res.status(403).json({ error: 'Unauthorized for this property.' });
        }
        if (await isMonthLocked(bill.propertyId, bill.businessDate)) {
            return res.status(423).json({ error: 'Cannot rebate: The month is locked for payroll.' });
        }
        const updated = await db_1.prisma.bill.update({
            where: { id },
            data: {
                status: 'REBATED',
                rebateReason: reason.trim(),
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: bill.propertyId,
            action: 'BILL_REBATE',
            targetType: 'Bill',
            targetId: bill.id,
            details: {
                checkNumber: bill.checkNumber,
                guest: bill.guestName,
                netAmount: bill.netAmount,
                reason: reason.trim(),
            },
        });
        return res.json({ bill: updated });
    }
    catch (error) {
        console.error('Rebate bill error:', error);
        return res.status(500).json({ error: 'Failed to rebate bill.' });
    }
});
// DELETE /api/bills/:id
// PDF Page 4: "Delete: Soft delete. The bill is removed from totals but kept in history, and its number is released so you can reuse it."
exports.billsRouter.delete('/:id', auth_1.requireAuth, async (req, res) => {
    try {
        const id = String(req.params.id);
        const bill = await db_1.prisma.bill.findUnique({ where: { id } });
        if (!bill)
            return res.status(404).json({ error: 'Bill not found.' });
        if (req.user.role !== 'GLOBAL_ADMIN' && !req.user.assignedPropertyIds.includes(bill.propertyId)) {
            return res.status(403).json({ error: 'Unauthorized for this property.' });
        }
        if (await isMonthLocked(bill.propertyId, bill.businessDate)) {
            return res.status(423).json({ error: 'Cannot delete: The month is locked for payroll.' });
        }
        // Soft delete: marks as DELETED
        const updated = await db_1.prisma.bill.update({
            where: { id },
            data: {
                status: 'DELETED',
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: bill.propertyId,
            action: 'BILL_DELETE',
            targetType: 'Bill',
            targetId: bill.id,
            details: {
                checkNumber: bill.checkNumber,
                releasedCheckNumber: true,
                guest: bill.guestName,
            },
        });
        return res.json({ message: `Bill #${bill.checkNumber} soft-deleted. Check number is now released.`, bill: updated });
    }
    catch (error) {
        console.error('Delete bill error:', error);
        return res.status(500).json({ error: 'Failed to delete bill.' });
    }
});
