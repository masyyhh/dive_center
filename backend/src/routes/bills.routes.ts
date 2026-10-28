import { boundedArray, validationIssues } from '../utils/validation';
import { isExcludedFromCredit } from '../utils/staffEligibility';
import { withPropertyPayrollTransaction, payrollReply } from '../utils/payrollTransaction';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';

import { businessToday, isBusinessDate } from '../utils/dates';

export const billsRouter = Router();

// Helper to check if a month is locked for a property
const isMonthLocked = async (client: Pick<typeof prisma, 'monthLock'>, propertyId: string, dateStr: string): Promise<boolean> => {
  const yearMonth = dateStr.substring(0, 7); // "YYYY-MM"
  const lock = await client.monthLock.findUnique({
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
billsRouter.get('/next-check', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.query.propertyId);
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) return res.status(404).json({ error: 'Property not found.' });

    // Find highest check number used by active or rebated bills
    const lastBill = await prisma.bill.findFirst({
      where: {
        propertyId,
        status: { in: ['ACTIVE', 'REBATED'] },
      },
      orderBy: { checkNumber: 'desc' },
      select: { checkNumber: true },
    });

    const nextNumber = lastBill ? lastBill.checkNumber + 1 : property.nextCheckNumber;
    return res.json({ nextCheckNumber: nextNumber });
  } catch (error) {
    console.error('Fetch next check error:', error);
    return res.status(500).json({ error: 'Failed to calculate next check number.' });
  }
});

// GET /api/bills/room-lookup?propertyId=...&roomNumber=...
// PDF Page 4: "If a bill already exists for that room today, typing the room number offers to fill in the guest details from it."
billsRouter.get('/room-lookup', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const { propertyId, roomNumber } = req.query;
    if (!roomNumber) return res.json({ found: false });

    const today = businessToday();
    const match = await prisma.bill.findFirst({
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

    return res.json({ found: false });
  } catch (error) {
    console.error('Room lookup error:', error);
    return res.status(500).json({ error: 'Failed to lookup room.' });
  }
});

// GET /api/bills?propertyId=...&startDate=...&endDate=...&search=...
billsRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const { propertyId, startDate, endDate, search, status } = req.query;

    const where: any = {
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

    let bills = await prisma.bill.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true } },
        items: true,
      },
      orderBy: [{ businessDate: 'desc' }, { checkNumber: 'desc' }],
    });

    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      bills = bills.filter(
        (b) =>
          b.guestName.toLowerCase().includes(q) ||
          b.roomNumber.toLowerCase().includes(q) ||
          String(b.checkNumber).includes(q) ||
          b.nationality.toLowerCase().includes(q)
      );
    }

    return res.json({ bills });
  } catch (error) {
    console.error('Fetch bills error:', error);
    return res.status(500).json({ error: 'Failed to fetch bills.' });
  }
});

// GET /api/bills/:id
billsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true } },
        items: {
          include: {
            sellerStaff: { select: { id: true, name: true, propertyId: true } },
            guideStaff: { select: { id: true, name: true, propertyId: true } },
            instructorStaff: { select: { id: true, name: true, propertyId: true } },
            photoStaff: { select: { id: true, name: true, propertyId: true } },
            videoStaff: { select: { id: true, name: true, propertyId: true } },
          },
        },
      },
    });

    if (!bill) return res.status(404).json({ error: 'Bill not found.' });

    if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(bill.propertyId)) {
      return res.status(403).json({ error: 'Unauthorized to view this bill.' });
    }

    for (const line of bill.items) {
      for (const role of ['sellerStaff', 'guideStaff', 'instructorStaff', 'photoStaff', 'videoStaff'] as const) {
        if (line[role] && line[role]!.propertyId !== bill.propertyId) line[role] = null;
      }
    }
    return res.json({ bill });
  } catch (error) {
    console.error('Get bill details error:', error);
    return res.status(500).json({ error: 'Failed to retrieve bill.' });
  }
});

const billItemSchema = z.object({
  itemId: z.string().optional().nullable(),
  itemName: z.string(),
  categoryName: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().min(0),
  discountPercent: z.number().min(0).max(100).default(0),
  sellerStaffId: z.string().optional().nullable(),
  guideStaffId: z.string().optional().nullable(),
  instructorStaffId: z.string().optional().nullable(),
  photoStaffId: z.string().optional().nullable(),
  videoStaffId: z.string().optional().nullable(),
  personalCommissionsJson: z.string().optional().nullable(),
  totalPersonalCommission: z.number().min(0).default(0),
});

const createBillSchema = z.object({
  propertyId: z.string(),
  checkNumber: z.number().int().positive(),
  businessDate: z.string().refine(isBusinessDate, 'Valid calendar date (YYYY-MM-DD) is required.'),
  guestName: z.string().min(1, 'Guest name is required'),
  roomNumber: z.string().min(1, 'Room number is required'),
  departureDate: z.string().optional().nullable(),
  nationality: z.string().default('Other'),
  tipAmount: z.number().min(0).default(0),
  tipStaffIds: boundedArray(z.string(), 1000).optional().default([]),
  items: boundedArray(billItemSchema, 200).refine(items => items.length > 0, 'At least one item is required on a bill'),
  notes: z.string().optional().nullable(),
});

// POST /api/bills (Create new bill)
billsRouter.post('/', requireAuth, requirePropertyAccess('body', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const parseResult = createBillSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Validation failed', details: validationIssues(parseResult.error) });
    }

    const data = parseResult.data;
    const result = await withPropertyPayrollTransaction(prisma, data.propertyId, async prisma => {

      // Check if month is locked
      if (await isMonthLocked(prisma, data.propertyId, data.businessDate)) {
        return payrollReply(423, {
          error: `Cannot create bill: The month (${data.businessDate.substring(0, 7)}) is locked for payroll.`,
        });
      }

      // PDF Page 3: "Numbers are unique to your centre: if you enter one a current bill already uses, the app stops the save and tells you."
      const existingCheck = await prisma.bill.findFirst({
        where: {
          propertyId: data.propertyId,
          checkNumber: data.checkNumber,
          status: { in: ['ACTIVE', 'REBATED'] }, // Only active or rebated hold the check number; soft deleted release it
        },
      });

      if (existingCheck) {
        return payrollReply(400, {
          error: `Check number #${data.checkNumber} is already in use by another bill in this centre. Please change the check number before saving.`,
        });
      }

      const property = await prisma.property.findUnique({ where: { id: data.propertyId } });
      if (!property) return payrollReply(404, { error: 'Property not found.' });

      const itemIds = [...new Set(data.items.map(line => line.itemId).filter((id): id is string => Boolean(id)))];
      const catalogue = await prisma.item.findMany({ where: { id: { in: itemIds }, propertyId: data.propertyId, isActive: true }, include: { category: true } });
      const itemMap = new Map(catalogue.filter(item => item.category.propertyId === data.propertyId).map(item => [item.id, item]));
      if (data.items.some(line => !line.itemId || !itemMap.has(line.itemId))) {
        return payrollReply(400, { error: 'Every activity must be an active catalogue item from this property.' });
      }
      const creditedIds = [...new Set([...data.tipStaffIds, ...data.items.flatMap(line => [line.sellerStaffId, line.guideStaffId, line.instructorStaffId, line.photoStaffId, line.videoStaffId].filter((id): id is string => Boolean(id)))])];
      const creditedStaff = await prisma.staffMember.findMany({ where: { id: { in: creditedIds }, propertyId: data.propertyId, isActive: true, hireDate: { lte: data.businessDate }, OR: [{ leavingDate: null }, { leavingDate: { gte: data.businessDate } }] }, select: { id: true } });
      if (creditedStaff.length !== creditedIds.length || new Set(data.tipStaffIds).size !== data.tipStaffIds.length) {
        return payrollReply(400, { error: 'Choose unique tip recipients and credited staff from this property.' });
      }

      const attendance = await prisma.attendance.findMany({ where: { propertyId: data.propertyId, date: data.businessDate, staffMemberId: { in: creditedIds } } });
      if (attendance.some(a => isExcludedFromCredit(a.status))) {
        return payrollReply(400, { error: 'Staff excluded by attendance on the business date cannot receive line commission or share tips. Remove them before saving.' });
      }

      // Mathematical calculations per PDF Page 3 & 4:
      // Gross -> - Discount -> + Service charge -> + Tax -> + Tip -> Net
      let grossAmount = 0;
      let totalDiscount = 0;

      const lineItemsData = data.items.map((line) => {
        const item = itemMap.get(line.itemId!)!;
        let parsedRates: Record<string, unknown> = {};
        try { parsedRates = item.personalRatesJson ? JSON.parse(item.personalRatesJson) : {}; } catch { /* Invalid catalogue rates pay no commission. */ }
        const rates: Record<string, number> = {};
        for (const role of ['seller', 'guide', 'instructor', 'photo', 'video'] as const) {
          const amount = parsedRates && parsedRates[role];
          if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) rates[role] = amount;
        }
        const totalPersonalCommission = Object.entries(rates).reduce((total, [role, rate]) => total + ((line as any)[`${role}StaffId`] ? rate * line.quantity : 0), 0);
        const lineGross = line.unitPrice * line.quantity;
        const discount = (lineGross * line.discountPercent) / 100;
        const lineTotal = lineGross - discount;

        grossAmount += lineGross;
        totalDiscount += discount;

        return {
          itemId: line.itemId || null,
          itemName: item.name,
          categoryName: item.category.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          lineTotal,
          sellerStaffId: line.sellerStaffId || null,
          guideStaffId: line.guideStaffId || null,
          instructorStaffId: line.instructorStaffId || null,
          photoStaffId: line.photoStaffId || null,
          videoStaffId: line.videoStaffId || null,
          personalCommissionsJson: JSON.stringify(rates),
          totalPersonalCommission,
        };
      });

      const netBeforeCharges = grossAmount - totalDiscount;
      const serviceChargeAmount = (netBeforeCharges * property.serviceChargeRate) / 100;
      const taxAmount = ((netBeforeCharges + serviceChargeAmount) * property.taxRate) / 100;
      const tipAmount = data.tipAmount || 0;
      const netAmount = netBeforeCharges + serviceChargeAmount + taxAmount + tipAmount;

      const bill = await prisma.bill.create({
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
          createdById: req.user!.id,
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
        await prisma.property.update({
          where: { id: property.id },
          data: { nextCheckNumber: data.checkNumber + 1 },
        });
      }

      await logAuditEvent({
        client: prisma,
        req,
        propertyId: bill.propertyId,
        action: 'BILL_CREATE',
        targetType: 'Bill',
        targetId: bill.id,
        details: { checkNumber: bill.checkNumber, guest: bill.guestName, net: bill.netAmount },
      });

      return payrollReply(201, { bill });
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'This check number is already in use by another live bill.' });
    console.error('Create bill error:', error);
    return res.status(500).json({ error: 'Failed to save bill.' });
  }
});

// POST /api/bills/:id/re-date
// PDF Page 4: "Re-date: Move a bill to a different business date (the number stays the same)."
billsRouter.post('/:id/re-date', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { newDate } = req.body;

    if (!isBusinessDate(newDate)) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
    }

    const target = await prisma.bill.findUnique({ where: { id }, select: { propertyId: true } });
    if (!target) return res.status(404).json({ error: 'Bill not found.' });
    const result = await withPropertyPayrollTransaction(prisma, target.propertyId, async prisma => {
      const bill = await prisma.bill.findUnique({ where: { id }, include: { items: true, property: { select: { deletedAt: true } } } });
      if (!bill) return payrollReply(404, { error: 'Bill not found.' });

      // Property authorization
      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(bill.propertyId)) {
        return payrollReply(403, { error: 'Unauthorized for this property.' });
      }

      if (bill.property?.deletedAt) return payrollReply(410, { error: 'This property has been removed. Bill history is read-only.' });

      // Check month locks on old and new dates

      if (await isMonthLocked(prisma, bill.propertyId, bill.businessDate)) {
        return payrollReply(423, { error: 'Cannot re-date: Original month is locked for payroll.' });
      }
      if (await isMonthLocked(prisma, bill.propertyId, newDate)) {
        return payrollReply(423, { error: 'Cannot re-date: Target month is locked for payroll.' });
      }

      const creditedIds = [...new Set([
        ...(bill.tipStaffIdsJson ? JSON.parse(bill.tipStaffIdsJson) as string[] : []),
        ...bill.items.flatMap(line => [line.sellerStaffId, line.guideStaffId, line.instructorStaffId, line.photoStaffId, line.videoStaffId].filter((id): id is string => Boolean(id))),
      ])];
      if (creditedIds.length) {
        const staff = await prisma.staffMember.findMany({ where: { id: { in: creditedIds }, propertyId: bill.propertyId, isActive: true, hireDate: { lte: newDate }, OR: [{ leavingDate: null }, { leavingDate: { gte: newDate } }] } });
        const attendance = await prisma.attendance.findMany({ where: { propertyId: bill.propertyId, date: newDate, staffMemberId: { in: creditedIds } } });
        if (staff.length !== creditedIds.length || attendance.some(a => isExcludedFromCredit(a.status))) {
          return payrollReply(400, { error: 'Cannot re-date: credited staff or tip recipients are unavailable on the target date.' });
        }
      }
      const oldDate = bill.businessDate;
      const updated = await prisma.bill.update({
        where: { id },
        data: { businessDate: newDate },
      });

      await logAuditEvent({
        client: prisma,
        req,
        propertyId: bill.propertyId,
        action: 'BILL_REDATE',
        targetType: 'Bill',
        targetId: bill.id,
        details: { checkNumber: bill.checkNumber, fromDate: oldDate, toDate: newDate },
      });

      return payrollReply(200, { bill: updated });
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Re-date bill error:', error);
    return res.status(500).json({ error: 'Failed to re-date bill.' });
  }
});

// POST /api/bills/:id/rebate
// PDF Page 4: "Rebate: Reverse a bill with a linked adjustment. The original stays on record; a rebated bill earns no commission."
billsRouter.post('/:id/rebate', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ error: 'A reason for rebate is required.' });
    }

    const target = await prisma.bill.findUnique({ where: { id }, select: { propertyId: true } });
    if (!target) return res.status(404).json({ error: 'Bill not found.' });
    const result = await withPropertyPayrollTransaction(prisma, target.propertyId, async prisma => {
      const bill = await prisma.bill.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
      if (!bill) return payrollReply(404, { error: 'Bill not found.' });

      if (bill.status === 'REBATED') {
        return payrollReply(400, { error: 'This bill has already been rebated.' });
      }

      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(bill.propertyId)) {
        return payrollReply(403, { error: 'Unauthorized for this property.' });
      }

      if (bill.property?.deletedAt) return payrollReply(410, { error: 'This property has been removed. Bill history is read-only.' });

      if (await isMonthLocked(prisma, bill.propertyId, bill.businessDate)) {
        return payrollReply(423, { error: 'Cannot rebate: The month is locked for payroll.' });
      }

      const updated = await prisma.bill.update({
        where: { id },
        data: {
          status: 'REBATED',
          rebateReason: reason.trim(),
        },
      });

      await logAuditEvent({
        client: prisma,
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

      return payrollReply(200, { bill: updated });
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'This check number is already in use by another live bill.' });
    console.error('Rebate bill error:', error);
    return res.status(500).json({ error: 'Failed to rebate bill.' });
  }
});

// DELETE /api/bills/:id
// PDF Page 4: "Delete: Soft delete. The bill is removed from totals but kept in history, and its number is released so you can reuse it."
billsRouter.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const target = await prisma.bill.findUnique({ where: { id }, select: { propertyId: true } });
    if (!target) return res.status(404).json({ error: 'Bill not found.' });
    const result = await withPropertyPayrollTransaction(prisma, target.propertyId, async prisma => {
      const bill = await prisma.bill.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
      if (!bill) return payrollReply(404, { error: 'Bill not found.' });

      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(bill.propertyId)) {
        return payrollReply(403, { error: 'Unauthorized for this property.' });
      }

      if (bill.property?.deletedAt) return payrollReply(410, { error: 'This property has been removed. Bill history is read-only.' });

      if (await isMonthLocked(prisma, bill.propertyId, bill.businessDate)) {
        return payrollReply(423, { error: 'Cannot delete: The month is locked for payroll.' });
      }

      // Soft delete: marks as DELETED
      const updated = await prisma.bill.update({
        where: { id },
        data: {
          status: 'DELETED',
        },
      });

      await logAuditEvent({
        client: prisma,
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

      return payrollReply(200, { message: `Bill #${bill.checkNumber} soft-deleted. Check number is now released.`, bill: updated });
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Delete bill error:', error);
    return res.status(500).json({ error: 'Failed to delete bill.' });
  }
});
