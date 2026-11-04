import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess } from '../middleware/rbac';
import { generateDailyExcelReport, generateMonthlyExcelWorkbook } from '../services/excelService';
import { isBusinessDate, isYearMonth } from '../utils/dates';

export function registerReportExportRoutes(reportsRouter: Router) {
  // GET /api/reports/export/daily?propertyId=...&date=...
  // PDF Page 6: Daily report — pick a date, download the day's .xlsx
  reportsRouter.get('/export/daily', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
    try {
      const { propertyId, date } = req.query;
      if(!isBusinessDate(date)) {
        return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
      }

      const buffer = await generateDailyExcelReport(String(propertyId), String(date));

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="Daily_Report_${date}.xlsx"`);
      return res.send(buffer);
    } catch(error) {
      console.error('Export daily excel error:', error);
      return res.status(500).json({ error: 'Failed to export daily report.' });
    }
  });

  // GET /api/reports/export/monthly?propertyId=...&yearMonth=...
  // PDF Page 6: Monthly report — pick a month and download full workbook .xlsx
  reportsRouter.get('/export/monthly', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
    try {
      const { propertyId, yearMonth } = req.query;
      if(!isYearMonth(yearMonth)) {
        return res.status(400).json({ error: 'Valid yearMonth (YYYY-MM) is required.' });
      }

      const buffer = await generateMonthlyExcelWorkbook(String(propertyId), String(yearMonth));

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="Monthly_Payroll_${yearMonth}.xlsx"`);
      return res.send(buffer);
    } catch(error) {
      console.error('Export monthly excel error:', error);
      return res.status(500).json({ error: 'Failed to export monthly workbook.' });
    }
  });

}
