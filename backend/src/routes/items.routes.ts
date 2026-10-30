import { validationIssues } from '../utils/validation';
import ExcelJS from 'exceljs';
import { withPropertyPayrollTransaction } from '../utils/payrollTransaction';
import { catalogueSpreadsheetHeaders, catalogueSpreadsheetRow, CatalogueError, parseCatalogue, nextItemCode, itemCodeAllocator, safeSpreadsheetText } from '../services/catalogueTransfer';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';
import { isPercentagePool, validPoolRate } from '../utils/poolRates';

export const itemsRouter = Router();

class BulkMediaConflict extends Error {}
const bulkMediaSchema = z.object({
  propertyId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1).max(200).refine(ids => new Set(ids).size === ids.length, 'Choose each activity once.'),
  includesComplimentaryMedia: z.boolean(),
  preview: z.boolean().default(true),
  expectedItems: z.array(z.object({ id: z.string(), updatedAt: z.iso.datetime() })).max(200).optional(),
}).strict();

itemsRouter.post('/bulk-complimentary-media', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body'), async (req, res) => {
  const parsed = bulkMediaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose 1–200 different activities and a photo/video setting.' });
  const { propertyId, itemIds, includesComplimentaryMedia, preview, expectedItems } = parsed.data;
  if (!preview && (!expectedItems || expectedItems.length !== itemIds.length || new Set(expectedItems.map(item => item.id)).size !== itemIds.length || expectedItems.some(item => !itemIds.includes(item.id)))) {
    return res.status(400).json({ error: 'Review these activities before saving the bulk update.' });
  }
  try {
    const result = await withPropertyPayrollTransaction(prisma, propertyId, async tx => {
      const property = await tx.property.findUnique({ where: { id: propertyId } });
      if (!property?.isActive || property.deletedAt) throw new CatalogueError('Select an active property.');
      const items = await tx.item.findMany({ where: { propertyId, id: { in: itemIds }, isActive: true }, orderBy: { code: 'asc' } });
      if (items.length !== itemIds.length) throw new BulkMediaConflict('Some selected activities are unavailable. Refresh the catalogue and review again.');
      const changedCount = items.filter(item => item.includesComplimentaryMedia !== includesComplimentaryMedia).length;
      if (!preview) {
        const versions = new Map(expectedItems!.map(item => [item.id, new Date(item.updatedAt)]));
        for (const item of items) {
          const updated = await tx.item.updateMany({ where: { id: item.id, propertyId, isActive: true, updatedAt: versions.get(item.id)! }, data: { includesComplimentaryMedia } });
          if (updated.count !== 1) throw new BulkMediaConflict('An activity changed since your review. Review the latest settings before saving.');
        }
        await logAuditEvent({ client: tx, req, propertyId, action: 'ITEM_BULK_MEDIA_UPDATE', targetType: 'Property', targetId: propertyId,
          details: { includesComplimentaryMedia, changedCount, items: items.map(item => ({ id: item.id, previous: item.includesComplimentaryMedia })) } });
      }
      return { preview, changedCount, total: items.length, includesComplimentaryMedia,
        items: items.map(item => ({ id: item.id, code: item.code, name: item.name, includesComplimentaryMedia: item.includesComplimentaryMedia, updatedAt: item.updatedAt })) };
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof BulkMediaConflict) return res.status(409).json({ error: error.message });
    if (error instanceof CatalogueError) return res.status(400).json({ error: error.message });
    console.error('Bulk media update error:', error);
    return res.status(500).json({ error: 'Could not update the selected activities.' });
  }
});

// GET /api/items?propertyId=...
itemsRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    if (typeof req.query.propertyId !== 'string' || !req.query.propertyId.trim()) return res.status(400).json({ error: 'Property ID is required.' });
    const propertyId = req.query.propertyId;
    const filter = z.enum(['true', 'false']).optional().safeParse(req.query.includeInactive);
    if (!filter.success) return res.status(400).json({ error: 'Invalid catalogue filter.' });
    const includeInactive = filter.data === 'true';
    if (includeInactive && !['GLOBAL_ADMIN', 'PROPERTY_MANAGER'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'Only administrators and property managers can manage archived activities.' });
    }

    const [categories, items] = await Promise.all([
      prisma.category.findMany({
        where: { propertyId },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.item.findMany({
        where: { propertyId, ...(includeInactive ? {} : { isActive: true }) },
        include: { category: true, _count: { select: { billItems: true } } },
        orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
      }),
    ]);

    return res.json({ categories, items: items.filter(item => item.category.propertyId === propertyId).map(({ _count, ...item }) => ({ ...item, hasBillHistory: _count.billItems > 0 })) });
  } catch (error) {
    console.error('Fetch items error:', error);
    return res.status(500).json({ error: 'Failed to fetch items catalogue.' });
  }
});

// Create the first catalogue category for a property that has not been set up yet.
itemsRouter.post(
  '/categories',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  requirePropertyAccess('body', 'propertyId'),
  async (req: Request, res: Response) => {
    const result = z.object({ propertyId: z.string().min(1), name: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Enter a category name of 1–80 characters.' });
    try {
      const { propertyId, name } = result.data;
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return res.status(404).json({ error: 'Property not found.' });
      const last = await prisma.category.aggregate({ where: { propertyId }, _max: { sortOrder: true } });
      const category = await prisma.category.create({ data: { propertyId, name, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
      await logAuditEvent({ req, propertyId, action: 'CATEGORY_CREATE', targetType: 'Category', targetId: category.id, details: { name } });
      return res.status(201).json({ category });
    } catch (error: any) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'A category with this name already exists in this property.' });
      console.error('Create category error:', error);
      return res.status(500).json({ error: 'Could not create the category. Please try again.' });
    }
  }
);

const commissionRoles = ['seller', 'guide', 'instructor', 'photo', 'video'];
const validRates = (value: string) => {
  if (!value.trim()) return true;
  try {
    const rates = JSON.parse(value);
    return rates !== null && typeof rates === 'object' && !Array.isArray(rates) && Object.entries(rates).every(([role, amount]) => commissionRoles.includes(role) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0);
  } catch { return false; }
};
const activityFields = z.object({
  categoryId: z.string().trim().min(1),
  code: z.string().trim().max(50).optional(),
  name: z.string().trim().min(2).max(200),
  price: z.number().finite().nonnegative(),
  poolType: z.enum(['COURSE_POOL', 'CERTIFICATION_POOL', 'DIVE_POOL', 'NONE']).default('NONE'),
  poolContribution: z.number().finite().min(0).optional(),
  includesComplimentaryMedia: z.boolean().default(false),
  personalRoles: z.string().max(100).refine(value => value.split(',').every(role => !role.trim() || commissionRoles.includes(role.trim())), 'Choose supported commission roles.').optional().nullable(),
  personalRatesJson: z.string().max(2000).refine(validRates, 'Enter a JSON object with nonnegative amounts for supported commission roles.').optional().nullable(),
});
const itemSchema = activityFields.extend({ propertyId: z.string().trim().min(1) }).strict()
  .transform(data => ({ ...data, poolContribution: data.poolContribution ?? (isPercentagePool(data.poolType) ? 10 : 0) }))
  .refine(data => validPoolRate(data.poolType, data.poolContribution), { path: ['poolContribution'], message: 'Course and dive pool rates must be between 0 and 100 percent.' });
const itemUpdateSchema = activityFields.omit({ poolType: true, poolContribution: true, includesComplimentaryMedia: true }).partial().extend({ poolType: z.enum(['COURSE_POOL', 'CERTIFICATION_POOL', 'DIVE_POOL', 'NONE']).optional(), poolContribution: z.number().finite().min(0).optional(), includesComplimentaryMedia: z.boolean().optional(), isActive: z.boolean().optional() }).strict().refine(data => Object.keys(data).length > 0, 'Choose an activity field to update.');

// Standard catalogue interchange. Property authorization applies equally to preview and commit.
itemsRouter.get('/export', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('query', 'propertyId'), async (req, res) => {
  try {
    const parsed = z.object({ propertyId: z.string().min(1), format: z.enum(['csv', 'xlsx']).default('xlsx'), template: z.enum(['true', 'false']).optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a property and CSV or Excel format.' });
    const { propertyId, format, template } = parsed.data;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Catalogue');
    sheet.addRow(catalogueSpreadsheetHeaders);
    if (template === 'true') sheet.addRow(['', 'Single boat dive', 'Dives', 75, 'Dive pool', 10, null, 5, 10, null, null, null, 'No', 'Active']);
    else {
      const items = await prisma.item.findMany({ where: { propertyId }, include: { category: true }, orderBy: { code: 'asc' } });
      for (const item of items) if (item.category.propertyId === propertyId) sheet.addRow(catalogueSpreadsheetRow(item).map(value => typeof value === 'string' ? safeSpreadsheetText(value) : value));
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = 'A1:N1';
    sheet.getRow(1).height = 42;
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19323C' } };
    sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    [18, 36, 24, 14, 22, 16, 24, 20, 20, 22, 24, 24, 25, 14].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    for (const index of [4, 7, 8, 9, 10, 11, 12]) sheet.getColumn(index).numFmt = '0.00';
    sheet.getCell('F1').note = 'Enter 10 for a 10% course/dive pool contribution after discounts, before tax and service charge.';
    sheet.getCell('G1').note = 'Fixed amount per unit for Certifications. No staff pool share or base-leader override is paid from Certifications.';
    sheet.getCell('M1').note = 'Yes adds a separate Photo line at $57.50 per unit on top of the activity price. Its selected team member earns $4.50 per unit; separate photographer/video rates are paused. No uses the separate rates. Blank retains the existing setting.';
    for (let row = 2; row <= sheet.rowCount; row++) {
      sheet.getCell(`E${row}`).dataValidation = { type: 'list', allowBlank: false, formulae: ['"Course pool,Dive pool,Certifications,No pool"'], showErrorMessage: true, error: 'Choose one of the listed pools.' };
      sheet.getCell(`M${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'], showErrorMessage: true, error: 'Choose Yes or No.' };
      sheet.getCell(`N${row}`).dataValidation = { type: 'list', allowBlank: false, formulae: ['"Active,Inactive"'], showErrorMessage: true, error: 'Choose Active or Inactive.' };
    }
    if (format === 'xlsx') {
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
        'Include Photo ($57.50): Yes adds a separate $57.50 Photo line per unit on top of the activity price. Its selected team member earns $4.50 per unit. Separate photo/video rates are paused.',
        'Include Photo ($57.50) = No uses the separate photographer and videographer amounts. Blank retains the existing checkbox setting.',
        'No commissions: choose No pool, leave every employee payment blank, and choose No for Include Photo ($57.50).',
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
  if (!parsed.success) return res.status(400).json({ error: 'Choose a CSV or Excel file up to 3 MB.' });
  try {
    const { propertyId, content, format, preview } = parsed.data;
    const rows = await parseCatalogue(content, format);
    const summary = await withPropertyPayrollTransaction(prisma, propertyId, async tx => {
      const property = await tx.property.findUnique({ where: { id: propertyId } });
      if (!property?.isActive || property.deletedAt) throw new CatalogueError('Select an active property.');
      const existing = await tx.item.findMany({ where: { propertyId }, include: { category: true } });
      const byCode = new Map(existing.map(item => [item.code, item]));
      const changes = new Map<string, number>();
      for (const row of rows) {
        const item = row.code ? byCode.get(row.code) : undefined;
        if (item && (item.poolType !== row.commission.poolType || (row.commission.poolType !== 'NONE' && item.poolContribution !== row.commission.poolContribution))) changes.set(item.id, row.row);
      }
      if (changes.size) {
        const used = await tx.billItem.findFirst({ where: { itemId: { in: [...changes.keys()] } }, select: { itemId: true } });
        if (used?.itemId) throw new CatalogueError(`Row ${changes.get(used.itemId)}: pool rules are used on saved bills. Leave the rules unchanged or import a new item with a blank code.`);
      }
      // Reserve every supplied code before allocating blank-code rows, even
      // when the supplied code appears later in the file.
      const allocateCode = itemCodeAllocator([...existing.map(item => item.code), ...rows.map(row => row.code)]);
      const updated = rows.filter(row => row.code && byCode.has(row.code)).length;
      const result = { created: rows.length - updated, updated, total: rows.length };
      if (preview) return { ...result, previewRows: rows.slice(0, 20).map(({ code, name, category, price, isActive, commission }) => ({
        code, name, category, price, isActive, action: code && byCode.has(code) ? 'update' : 'create',
        commission: { ...commission, includesComplimentaryMedia: commission.includesComplimentaryMedia ?? byCode.get(code)?.includesComplimentaryMedia ?? false },
      })) };
      const categories = await tx.category.findMany({ where: { propertyId } });
      const categoryMap = new Map(categories.map(category => [category.name.toLowerCase(), category]));
      for (const row of rows) {
        let category = categoryMap.get(row.category.toLowerCase());
        if (!category) {
          category = await tx.category.create({ data: { propertyId, name: row.category, sortOrder: categoryMap.size + 1 } });
          categoryMap.set(row.category.toLowerCase(), category);
        }
        const data = { name: row.name, categoryId: category.id, price: row.price, isActive: row.isActive,
          includesComplimentaryMedia: row.commission.includesComplimentaryMedia,
          poolType: row.commission.poolType, poolContribution: row.commission.poolContribution,
          personalRatesJson: JSON.stringify(row.commission.personalRates), personalRoles: Object.keys(row.commission.personalRates).join(',') };
        const existingItem = row.code ? byCode.get(row.code) : undefined;
        const item = existingItem ? await tx.item.update({ where: { id: existingItem.id }, data })
          : await tx.item.create({ data: { ...data, propertyId, code: row.code || allocateCode(category.name) } });
        await logAuditEvent({ client: tx, req, propertyId, action: existingItem ? 'ITEM_UPDATE' : 'ITEM_CREATE', targetType: 'Item', targetId: item.id, details: { source: 'catalogue-import', code: item.code, name: item.name, price: item.price, isActive: item.isActive } });
      }
      await logAuditEvent({ client: tx, req, propertyId, action: 'CATALOGUE_IMPORT', targetType: 'Item', details: result });
      return result;
    }, 60000);
    return res.json({ preview, ...summary });
  } catch (error) {
    if (error instanceof CatalogueError) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: 'Could not import catalogue. No items were changed.' });
  }
});

// POST /api/items (GLOBAL_ADMIN or PROPERTY_MANAGER)
itemsRouter.post(
  '/',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  requirePropertyAccess('body', 'propertyId'),
  async (req: Request, res: Response) => {
    try {
      const parseResult = itemSchema.safeParse(req.body);
      if (!parseResult.success) {
        const issue = parseResult.error.issues[0];
        return res.status(400).json({ error: `Invalid ${issue.path.join('.') || 'activity'}: ${issue.message}`, details: validationIssues(parseResult.error) });
      }

      const data = parseResult.data;
      const item = await withPropertyPayrollTransaction(prisma, data.propertyId, async tx => {
        const category = await tx.category.findFirst({ where: { id: data.categoryId, propertyId: data.propertyId } });
        if (!category) throw new CatalogueError('Choose a category from this property.');
        const property = await tx.property.findUnique({ where: { id: data.propertyId } });
        if (!property?.isActive || property.deletedAt) throw new CatalogueError('Select an active property.');
        const code = await nextItemCode(tx, data.propertyId, category.name);
        return tx.item.create({ data: { ...data, code }, include: { category: true } });
      });

      await logAuditEvent({
        req,
        propertyId: item.propertyId,
        action: 'ITEM_CREATE',
        targetType: 'Item',
        targetId: item.id,
        details: { code: item.code, name: item.name, price: item.price, includesComplimentaryMedia: item.includesComplimentaryMedia },
      });

      return res.status(201).json({ item });
    } catch (error: any) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'An activity with this code already exists in this property, including archived activities.' });
      if (error instanceof CatalogueError) return res.status(400).json({ error: error.message });
      console.error('Create item error:', error);
      return res.status(500).json({ error: 'Failed to create item.' });
    }
  }
);

// PUT /api/items/:id
itemsRouter.put(
  '/:id',
  requireAuth,
  requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const existing = await prisma.item.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
      if (!existing) {
        return res.status(404).json({ error: 'Item not found.' });
      }

      if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) {
        return res.status(403).json({ error: 'Unauthorized for this property.' });
      }

      if (existing.property?.deletedAt) return res.status(410).json({ error: 'This property has been removed. Its records are read-only.' });

      const parsed = itemUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return res.status(400).json({ error: `Invalid ${issue.path.join('.') || 'activity'}: ${issue.message}`, details: validationIssues(parsed.error) });
      }
      const data = parsed.data;
      if (data.code !== undefined && data.code !== existing.code) return res.status(400).json({ error: 'Item codes are generated by the system and cannot be changed.' });

      const effectiveCategoryId = data.categoryId ?? existing.categoryId;
      const category = typeof effectiveCategoryId === 'string' && await prisma.category.findFirst({ where: { id: effectiveCategoryId, propertyId: existing.propertyId } });
      if (!category) return res.status(400).json({ error: 'Choose a category from this property.' });

      // Keep rules stable for billed activities, including retained legacy records.
      if (!validPoolRate(data.poolType ?? existing.poolType, data.poolContribution ?? existing.poolContribution)) {
        return res.status(400).json({ error: 'Course and dive pool rates must be between 0 and 100 percent.' });
      }
      const poolRulesChanged = (data.poolType !== undefined && data.poolType !== existing.poolType) || ((data.poolType ?? existing.poolType) !== 'NONE' && data.poolContribution !== undefined && data.poolContribution !== existing.poolContribution);
      if (poolRulesChanged && await prisma.billItem.count({ where: { itemId: id } })) {
        return res.status(409).json({ error: 'This activity is used on saved bills. Create a new activity to change pool rules without changing historical payroll.' });
      }

      const updated = await prisma.item.update({
        where: { id },
        data,
        include: { category: true },
      });

      await logAuditEvent({
        req,
        propertyId: updated.propertyId,
        action: data.isActive === true && !existing.isActive ? 'ITEM_RESTORE' : data.isActive === false && existing.isActive ? 'ITEM_DELETE' : 'ITEM_UPDATE',
        targetType: 'Item',
        targetId: updated.id,
        details: { code: updated.code, name: updated.name, price: updated.price, isActive: updated.isActive, previousPrice: existing.price, includesComplimentaryMedia: updated.includesComplimentaryMedia, previousIncludesComplimentaryMedia: existing.includesComplimentaryMedia },
      });

      return res.json({ item: updated });
    } catch (error: any) {
      if (error?.code === 'P2002') return res.status(409).json({ error: 'An activity with this code already exists in this property, including archived activities.' });
      console.error('Update item error:', error);
      return res.status(500).json({ error: 'Failed to update item.' });
    }
  }
);

// Removing an activity disables it for new bills and keeps existing bill/commission records.
itemsRouter.delete('/:id', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.item.findUnique({ where: { id }, include: { property: { select: { deletedAt: true } } } });
    if (!existing) return res.status(404).json({ error: 'Activity not found.' });
    if (req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(existing.propertyId)) return res.status(403).json({ error: 'Unauthorized for this property.' });
    if (existing.property.deletedAt) return res.status(410).json({ error: 'This property has been removed. Its records are read-only.' });
    const item = await prisma.item.update({ where: { id }, data: { isActive: false } });
    if (existing.isActive) await logAuditEvent({ req, propertyId: item.propertyId, action: 'ITEM_DELETE', targetType: 'Item', targetId: id, details: { code: item.code, name: item.name, historyRetained: true } });
    return res.json({ message: 'Activity removed from new bills. Existing bills and history have been retained.', item });
  } catch {
    console.error('Delete activity failed.');
    return res.status(500).json({ error: 'Could not delete this activity. Please try again.' });
  }
});
