import { photoIds } from '../utils/photoCredits';
import { instructorIds } from '../utils/instructorCredits';
import { isExcludedFromCredit } from '../utils/staffEligibility';
import { withPropertyPayrollTransaction, payrollReply } from '../utils/payrollTransaction';
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { logAuditEvent } from '../services/auditService';
import { isBusinessDate } from '../utils/dates';
import { isMonthLocked } from './bill.payroll';

export function registerBillActionRoutes(billsRouter: Router) {
  // POST /api/bills/:id/re-date
  // PDF Page 4: "Re-date: Move a bill to a different business date (the number stays the same)."
  billsRouter.post('/:id/re-date', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { newDate } = req.body;

      if(!isBusinessDate(newDate)) {
        return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
      }

      const target = await prisma.bill.findUnique({ where: { id }, select: { propertyId: true } });
      if(!target) return res.status(404).json({ error: 'Bill not found.' });
      const result = await withPropertyPayrollTransaction(prisma, target.propertyId, async prisma => {
        const bill = await prisma.bill.findUnique({ where: { id }, include: { items: { include: { instructorCredits: true, photoCredits: true } }, property: { select: { deletedAt: true } } } });
        if(!bill) return payrollReply(404, { error: 'Bill not found.' });

        // Property authorization
        if(req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(bill.propertyId)) {
          return payrollReply(403, { error: 'Unauthorized for this property.' });
        }

        if(bill.property?.deletedAt) return payrollReply(410, { error: 'This property has been removed. Bill history is read-only.' });

        // Check month locks on old and new dates

        if(await isMonthLocked(prisma, bill.propertyId, bill.businessDate)) {
          return payrollReply(423, { error: 'Cannot re-date: Original month is locked for payroll.' });
        }
        if(await isMonthLocked(prisma, bill.propertyId, newDate)) {
          return payrollReply(423, { error: 'Cannot re-date: Target month is locked for payroll.' });
        }

        const creditedIds = [...new Set([
          ...(bill.tipStaffIdsJson ? JSON.parse(bill.tipStaffIdsJson) as string[] : []),
          ...bill.items.flatMap(line => [line.sellerStaffId, line.guideStaffId, ...instructorIds(line), ...photoIds(line), line.videoStaffId].filter((id): id is string => Boolean(id))),
        ])];
        if(creditedIds.length) {
          const staff = await prisma.staffMember.findMany({ where: { id: { in: creditedIds }, propertyId: bill.propertyId, isActive: true, hireDate: { lte: newDate }, OR: [{ leavingDate: null }, { leavingDate: { gte: newDate } }] } });
          const attendance = await prisma.attendance.findMany({ where: { propertyId: bill.propertyId, date: newDate, staffMemberId: { in: creditedIds } } });
          if(staff.length !== creditedIds.length || attendance.some(a => isExcludedFromCredit(a.status))) {
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
    } catch(error) {
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

      if(!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({ error: 'A reason for rebate is required.' });
      }

      const target = await prisma.bill.findUnique({ where: { id }, select: { propertyId: true } });
      if(!target) return res.status(404).json({ error: 'Bill not found.' });
      const result = await withPropertyPayrollTransaction(prisma, target.propertyId, async prisma => {
        const bill = await prisma.bill.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
        if(!bill) return payrollReply(404, { error: 'Bill not found.' });

        if(bill.status === 'REBATED') {
          return payrollReply(400, { error: 'This bill has already been rebated.' });
        }

        if(req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(bill.propertyId)) {
          return payrollReply(403, { error: 'Unauthorized for this property.' });
        }

        if(bill.property?.deletedAt) return payrollReply(410, { error: 'This property has been removed. Bill history is read-only.' });

        if(await isMonthLocked(prisma, bill.propertyId, bill.businessDate)) {
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
    } catch(error) {
      if((error as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'This check number is already in use by another live bill.' });
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
      if(!target) return res.status(404).json({ error: 'Bill not found.' });
      const result = await withPropertyPayrollTransaction(prisma, target.propertyId, async prisma => {
        const bill = await prisma.bill.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
        if(!bill) return payrollReply(404, { error: 'Bill not found.' });

        if(req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(bill.propertyId)) {
          return payrollReply(403, { error: 'Unauthorized for this property.' });
        }

        if(bill.property?.deletedAt) return payrollReply(410, { error: 'This property has been removed. Bill history is read-only.' });

        if(await isMonthLocked(prisma, bill.propertyId, bill.businessDate)) {
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
    } catch(error) {
      console.error('Delete bill error:', error);
      return res.status(500).json({ error: 'Failed to delete bill.' });
    }
  });

}
