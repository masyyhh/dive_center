import ExcelJS from 'exceljs';
import { withPropertyPayrollTransaction } from '../utils/payrollTransaction';
import { catalogueSpreadsheetHeaders, catalogueSpreadsheetRow, CatalogueError, parseCatalogue, itemCodeAllocator, safeSpreadsheetText } from '../services/catalogueTransfer';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';

export function registerCatalogueTransferRoutes(itemsRouter: Router) {
  // Standard catalogue interchange. Property authorization applies equally to preview and commit.
  itemsRouter.get('/export', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('query', 'propertyId'), async (req, res) => {
    try {
      const parsed = z.object({ propertyId: z.string().min(1), format: z.enum(['csv', 'xlsx']).default('xlsx'), template: z.enum(['true', 'false']).optional() }).safeParse(req.query);
      if(!parsed.success) return res.status(400).json({ error: 'Choose a property and CSV or Excel format.' });
      const { propertyId, format, template } = parsed.data;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Catalogue');
      sheet.addRow(catalogueSpreadsheetHeaders);
      if(template === 'true') sheet.addRow(['', 'Single boat dive', 'Dives', 75, 'Dive pool', 10, null, 5, 10, null, null, null, 'No', 'Active']);
      else {
        const items = await prisma.item.findMany({ where: { propertyId }, include: { category: true }, orderBy: { code: 'asc' } });
        for(const item of items) if(item.category.propertyId === propertyId) sheet.addRow(catalogueSpreadsheetRow(item).map(value => typeof value === 'string' ? safeSpreadsheetText(value) : value));
      }
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = 'A1:N1';
      sheet.getRow(1).height = 42;
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19323C' } };
      sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
      [18, 36, 24, 14, 22, 16, 24, 20, 20, 22, 24, 24, 25, 14].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
      for(const index of [4, 7, 8, 9, 10, 11, 12]) sheet.getColumn(index).numFmt = '0.00';
      sheet.getCell('F1').note = 'Enter 10 for a 10% course/dive pool contribution after discounts, before tax and service charge.';
      sheet.getCell('G1').note = 'Fixed amount per unit for Certifications. No staff pool share or base-leader override is paid from Certifications.';
      sheet.getCell('M1').note = 'Yes adds a separate Photo line at $41.975 per unit on top of the activity price. Its selected team member earns $4.50 per unit; separate photographer/video rates are paused. No uses the separate rates. Blank retains the existing setting.';
      for(let row = 2;row <= sheet.rowCount;row++) {
        sheet.getCell(`E${row}`).dataValidation = { type: 'list', allowBlank: false, formulae: ['"Course pool,Dive pool,Certifications,No pool"'], showErrorMessage: true, error: 'Choose one of the listed pools.' };
        sheet.getCell(`M${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'], showErrorMessage: true, error: 'Choose Yes or No.' };
        sheet.getCell(`N${row}`).dataValidation = { type: 'list', allowBlank: false, formulae: ['"Active,Inactive"'], showErrorMessage: true, error: 'Choose Active or Inactive.' };
      }
      if(format === 'xlsx') {
        const guide = workbook.addWorksheet('Instructions');
        guide.getColumn(1).width = 105;
        const notes = [
          'How to update your catalogue',
          'Edit the Catalogue sheet. Keep its column names and order unchanged.',
          template === 'true' ? 'Replace or delete the example row before importing your own services.' : 'Existing item codes update matching services in this property. Blank codes are generated when saving.',
          'Pool: choose Course pool, Dive pool, Certifications or No pool.',
          'Pool Rate (%): enter 10 for 10% on course/dive services after discounts, before tax and service charge. Leave blank for other pools.',
          'Certifications Amount / Unit: fixed amount per service unit. Leave blank for other pools. Certifications pay no staff pool commission.',
          'Employee payment columns: fixed amounts per unit. Blank means the role has no payment; 0 explicitly enables the role with a zero payment.',
          'Include Photo ($41.975): Yes adds a separate $41.975 Photo line per unit on top of the activity price. Its selected team member earns $4.50 per unit. Separate photo/video rates are paused.',
          'Include Photo ($41.975) = No uses the separate photographer and videographer amounts. Blank retains the existing checkbox setting.',
          'No commissions: choose No pool, leave every employee payment blank, and choose No for Include Photo ($41.975).',
          'Status: Active or Inactive. Existing bill prices and saved commissions are retained.',
          'Upload CSV or Excel (.xlsx), up to 3 MB and 2,000 activities. Review the import before applying it.',
        ];
        notes.forEach((note, index) => { const row = guide.addRow([note]); row.alignment = { wrapText: true, vertical: 'top' }; row.height = index ? 42 : 28; });
        guide.getRow(1).font = { bold: true, size: 16 };
      }
      const bytes = format === 'csv' ? await workbook.csv.writeBuffer({ sheetName: 'Catalogue' }) : await workbook.xlsx.writeBuffer({ useSharedStrings: true });
      await logAuditEvent({ req, propertyId, action: 'CATALOGUE_EXPORT', targetType: 'Item', details: { format, template: template === 'true', count: sheet.rowCount - 1 } });
      res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="catalogue.${format}"`);
      return res.send(Buffer.from(bytes));
    } catch { return res.status(500).json({ error: 'Could not export the catalogue.' }); }
  });

  itemsRouter.post('/import', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body', 'propertyId'), async (req, res) => {
    const parsed = z.object({ propertyId: z.string().min(1), format: z.enum(['csv', 'xlsx']), content: z.string().max(4 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/), preview: z.boolean().default(true) }).safeParse(req.body);
    if(!parsed.success) return res.status(400).json({ error: 'Choose a CSV or Excel file up to 3 MB.' });
    try {
      const { propertyId, content, format, preview } = parsed.data;
      const rows = await parseCatalogue(content, format);
      const summary = await withPropertyPayrollTransaction(prisma, propertyId, async tx => {
        const property = await tx.property.findUnique({ where: { id: propertyId } });
        if(!property?.isActive || property.deletedAt) throw new CatalogueError('Select an active property.');
        const existing = await tx.item.findMany({ where: { propertyId }, include: { category: true } });
        const byCode = new Map(existing.map(item => [item.code, item]));
        const changes = new Map<string, number>();
        for(const row of rows) {
          const item = row.code ? byCode.get(row.code) : undefined;
          if(item && (item.poolType !== row.commission.poolType || (row.commission.poolType !== 'NONE' && item.poolContribution !== row.commission.poolContribution))) changes.set(item.id, row.row);
        }
        if(changes.size) {
          const used = await tx.billItem.findFirst({ where: { itemId: { in: [...changes.keys()] } }, select: { itemId: true } });
          if(used?.itemId) throw new CatalogueError(`Row ${changes.get(used.itemId)}: pool rules are used on saved bills. Leave the rules unchanged or import a new item with a blank code.`);
        }
        // Reserve every supplied code before allocating blank-code rows, even
        // when the supplied code appears later in the file.
        const allocateCode = itemCodeAllocator([...existing.map(item => item.code), ...rows.map(row => row.code)]);
        const updated = rows.filter(row => row.code && byCode.has(row.code)).length;
        const result = { created: rows.length - updated, updated, total: rows.length };
        if(preview) return {
          ...result, previewRows: rows.slice(0, 20).map(({ code, name, category, price, isActive, commission }) => ({
            code, name, category, price, isActive, action: code && byCode.has(code) ? 'update' : 'create',
            commission: { ...commission, includesComplimentaryMedia: commission.includesComplimentaryMedia ?? byCode.get(code)?.includesComplimentaryMedia ?? false },
          }))
        };
        const categories = await tx.category.findMany({ where: { propertyId } });
        const categoryMap = new Map(categories.map(category => [category.name.toLowerCase(), category]));
        for(const row of rows) {
          let category = categoryMap.get(row.category.toLowerCase());
          if(!category) {
            category = await tx.category.create({ data: { propertyId, name: row.category, sortOrder: categoryMap.size + 1 } });
            categoryMap.set(row.category.toLowerCase(), category);
          }
          const data = {
            name: row.name, categoryId: category.id, price: row.price, isActive: row.isActive,
            includesComplimentaryMedia: row.commission.includesComplimentaryMedia,
            poolType: row.commission.poolType, poolContribution: row.commission.poolContribution,
            personalRatesJson: JSON.stringify(row.commission.personalRates), personalRoles: Object.keys(row.commission.personalRates).join(',')
          };
          const existingItem = row.code ? byCode.get(row.code) : undefined;
          const item = existingItem ? await tx.item.update({ where: { id: existingItem.id }, data })
            : await tx.item.create({ data: { ...data, propertyId, code: row.code || allocateCode(category.name) } });
          await logAuditEvent({ client: tx, req, propertyId, action: existingItem ? 'ITEM_UPDATE' : 'ITEM_CREATE', targetType: 'Item', targetId: item.id, details: { source: 'catalogue-import', code: item.code, name: item.name, price: item.price, isActive: item.isActive } });
        }
        await logAuditEvent({ client: tx, req, propertyId, action: 'CATALOGUE_IMPORT', targetType: 'Item', details: result });
        return result;
      }, 60000);
      return res.json({ preview, ...summary });
    } catch(error) {
      if(error instanceof CatalogueError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Could not import catalogue. No items were changed.' });
    }
  });

}
