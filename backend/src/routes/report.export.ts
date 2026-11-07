import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess } from '../middleware/rbac';
import { generateDailyPdfReport, generateMonthlyPdfReport } from '../services/pdfReportService';
import { isBusinessDate, isYearMonth } from '../utils/dates';
import { prisma } from '../db';

export function registerReportExportRoutes(reportsRouter: Router) {
  // GET /api/reports/export/daily?propertyId=...&date=...
  // Daily printable report for the selected date.
  reportsRouter.get('/export/daily', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
    try {
      const { propertyId, date } = req.query;
      if(!isBusinessDate(date)) {
        return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
      }

      const buffer = await generateDailyPdfReport(String(propertyId), String(date));

      res.setHeader(
        'Content-Type',
        'application/pdf'
      );
      res.setHeader('Content-Disposition', `attachment; filename="Daily_Report_${date}.pdf"`);
      return res.send(buffer);
    } catch(error) {
      console.error('Export daily PDF error:', error);
      return res.status(500).json({ error: 'Failed to export daily report.' });
    }
  });

  // GET /api/reports/export/monthly?propertyId=...&yearMonth=...
  // Complete monthly printable report; sections start on separate pages.
  reportsRouter.get('/export/monthly', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
    try {
      const { propertyId, yearMonth } = req.query;
      if(!isYearMonth(yearMonth)) {
        return res.status(400).json({ error: 'Valid yearMonth (YYYY-MM) is required.' });
      }

      const account = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } });
      if (!account) return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
      const buffer = await generateMonthlyPdfReport(String(propertyId), String(yearMonth), account.name);

      res.setHeader(
        'Content-Type',
        'application/pdf'
      );
      res.setHeader('Content-Disposition', `attachment; filename="Monthly_Report_${yearMonth}.pdf"`);
      return res.send(buffer);
    } catch(error) {
      console.error('Export monthly PDF error:', error);
      return res.status(500).json({ error: 'Failed to export monthly report.' });
    }
  });

}
