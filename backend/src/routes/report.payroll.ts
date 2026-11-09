import { withPropertyPayrollTransaction, payrollReply } from '../utils/payrollTransaction';
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { calculateCommissionForPeriod } from '../services/commissionService';
import { logAuditEvent } from '../services/auditService';
import { isYearMonth, isDateRange } from '../utils/dates';

export function registerReportPayrollRoutes(reportsRouter: Router) {
  // POST /api/reports/recompute
  // PDF Page 6: "The Recompute commission button forces a recalculation if you want to confirm the figures."
  reportsRouter.post('/recompute', requireAuth, requirePropertyAccess('body', 'propertyId'), async (req: Request, res: Response) => {
    try {
      const { propertyId, startDate, endDate } = req.body;
      if(!isDateRange(startDate, endDate)) {
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

      if(locks.length > 0) {
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
    } catch(error) {
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
        if(lock !== undefined && typeof lock !== 'boolean') return res.status(400).json({ error: 'Lock must be true or false.' });
        if(!isYearMonth(yearMonth)) {
          return res.status(400).json({ error: 'Valid yearMonth (YYYY-MM) is required.' });
        }

        const result = await withPropertyPayrollTransaction(prisma, String(propertyId), async prisma => {
          const shouldLock = lock ?? true;

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
      } catch(error) {
        console.error('Month lock error:', error);
        return res.status(500).json({ error: 'Failed to update month lock status.' });
      }
    }
  );

}
