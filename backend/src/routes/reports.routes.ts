import { Router } from 'express';
import { registerReportReadRoutes } from './report.read';
import { registerReportPayrollRoutes } from './report.payroll';
import { registerReportExportRoutes } from './report.export';

export const reportsRouter = Router();

// Preserve read, payroll-control, then export endpoint registration order.
registerReportReadRoutes(reportsRouter);
registerReportPayrollRoutes(reportsRouter);
registerReportExportRoutes(reportsRouter);
