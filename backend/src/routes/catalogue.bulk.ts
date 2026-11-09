import { withPropertyPayrollTransaction } from '../utils/payrollTransaction';
import { CatalogueError } from '../services/catalogueTransfer';
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';

export function registerCatalogueBulkRoutes(itemsRouter: Router) {
  const bulkDeleteSchema = z.object({
    propertyId: z.string().min(1),
    itemIds: z.array(z.string().min(1)).min(1).max(200).refine(ids => new Set(ids).size === ids.length),
  }).strict();

  itemsRouter.post('/bulk-delete', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body'), async (req, res) => {
    const parsed = bulkDeleteSchema.safeParse(req.body);
    if(!parsed.success) return res.status(400).json({ error: 'Choose 1–200 different catalogue activities.' });
    const { propertyId, itemIds } = parsed.data;
    try {
      const deletedCount = await withPropertyPayrollTransaction(prisma, propertyId, async tx => {
        const property = await tx.property.findUnique({ where: { id: propertyId } });
        if(!property?.isActive || property.deletedAt) throw new CatalogueError('Select an active property.');
        const items = await tx.item.findMany({ where: { propertyId, id: { in: itemIds }, isActive: true } });
        if(items.length !== itemIds.length) throw new CatalogueError('Some selected activities are unavailable. Refresh the catalogue and select again.');
        const result = await tx.item.updateMany({ where: { propertyId, id: { in: itemIds }, isActive: true }, data: { isActive: false } });
        if(result.count !== items.length) throw new CatalogueError('The selection changed. Refresh the catalogue and select again.');
        for(const item of items) {
          await logAuditEvent({
            client: tx, req, propertyId, action: 'ITEM_DELETE', targetType: 'Item', targetId: item.id,
            details: { code: item.code, name: item.name, historyRetained: true, source: 'catalogue-bulk-delete' }
          });
        }
        return result.count;
      });
      return res.json({ deletedCount });
    } catch(error) {
      if(error instanceof CatalogueError) return res.status(400).json({ error: error.message });
      console.error('Bulk catalogue delete failed.');
      return res.status(500).json({ error: 'Could not delete the selected activities. Please try again.' });
    }
  });

  class PermanentDeleteConflict extends Error { }
  const permanentDeleteSchema = bulkDeleteSchema.extend({ confirmation: z.literal('DELETE PERMANENTLY') });

  itemsRouter.post('/bulk-permanent-delete', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body'), async (req, res) => {
    const parsed = permanentDeleteSchema.safeParse(req.body);
    if(!parsed.success) return res.status(400).json({ error: 'Select 1–200 different activities and type DELETE PERMANENTLY to confirm.' });
    const { propertyId, itemIds } = parsed.data;
    try {
      const deletedCount = await withPropertyPayrollTransaction(prisma, propertyId, async tx => {
        const property = await tx.property.findUnique({ where: { id: propertyId } });
        if(!property?.isActive || property.deletedAt) throw new CatalogueError('Select an active property.');
        // FK inserts take key-share locks. Hold these rows until deletion and auditing
        // commit so a concurrent package save cannot silently lose a service.
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Item" WHERE "propertyId" = ${propertyId} AND "id" IN (${Prisma.join(itemIds)}) ORDER BY "id" FOR UPDATE`);
        const items = await tx.item.findMany({ where: { propertyId, id: { in: itemIds } }, include: { _count: { select: { billItems: true, packageItems: true } } } });
        if(items.length !== itemIds.length) throw new PermanentDeleteConflict('Some selected activities are unavailable. Refresh the catalogue and select again.');
        if(items.some(item => item.isActive)) throw new PermanentDeleteConflict('Delete activities normally first, then permanently delete them from Show deleted activities.');
        if(items.some(item => item._count.billItems || item._count.packageItems)) throw new PermanentDeleteConflict('Activities used on saved bills or in packages cannot be permanently deleted. Remove package references first; billed activities must stay in history. No activities were deleted.');
        const result = await tx.item.deleteMany({ where: { propertyId, id: { in: itemIds }, isActive: false } });
        if(result.count !== items.length) throw new PermanentDeleteConflict('The selection changed. Refresh the catalogue and select again.');
        for(const item of items) {
          // Permanent deletion must roll back if its audit record cannot be saved.
          await tx.auditLog.create({
            data: {
              propertyId, userId: req.user!.id, action: 'ITEM_PERMANENT_DELETE', targetType: 'Item', targetId: item.id,
              details: JSON.stringify({ code: item.code, name: item.name, permanent: true }), ipAddress: req.ip || req.socket?.remoteAddress || '127.0.0.1'
            }
          });
        }
        return result.count;
      });
      return res.json({ deletedCount });
    } catch(error) {
      if(error instanceof PermanentDeleteConflict) return res.status(409).json({ error: error.message });
      if(error instanceof CatalogueError) return res.status(400).json({ error: error.message });
      console.error('Permanent catalogue deletion failed.');
      return res.status(500).json({ error: 'Could not permanently delete the selected activities. No activities were deleted.' });
    }
  });

  class BulkMediaConflict extends Error { }
  const bulkMediaSchema = z.object({
    propertyId: z.string().min(1),
    itemIds: z.array(z.string().min(1)).min(1).max(200).refine(ids => new Set(ids).size === ids.length, 'Choose each activity once.'),
    includesComplimentaryMedia: z.boolean(),
    preview: z.boolean().default(true),
    expectedItems: z.array(z.object({ id: z.string(), updatedAt: z.iso.datetime() })).max(200).optional(),
  }).strict();

  itemsRouter.post('/bulk-complimentary-media', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body'), async (req, res) => {
    const parsed = bulkMediaSchema.safeParse(req.body);
    if(!parsed.success) return res.status(400).json({ error: 'Choose 1–200 different activities and a photo/video setting.' });
    const { propertyId, itemIds, includesComplimentaryMedia, preview, expectedItems } = parsed.data;
    if(!preview && (!expectedItems || expectedItems.length !== itemIds.length || new Set(expectedItems.map(item => item.id)).size !== itemIds.length || expectedItems.some(item => !itemIds.includes(item.id)))) {
      return res.status(400).json({ error: 'Review these activities before saving the bulk update.' });
    }
    try {
      const result = await withPropertyPayrollTransaction(prisma, propertyId, async tx => {
        const property = await tx.property.findUnique({ where: { id: propertyId } });
        if(!property?.isActive || property.deletedAt) throw new CatalogueError('Select an active property.');
        const items = await tx.item.findMany({ where: { propertyId, id: { in: itemIds }, isActive: true }, orderBy: { code: 'asc' } });
        if(items.length !== itemIds.length) throw new BulkMediaConflict('Some selected activities are unavailable. Refresh the catalogue and review again.');
        const changedCount = items.filter(item => item.includesComplimentaryMedia !== includesComplimentaryMedia).length;
        if(!preview) {
          const versions = new Map(expectedItems!.map(item => [item.id, new Date(item.updatedAt)]));
          for(const item of items) {
            const updated = await tx.item.updateMany({ where: { id: item.id, propertyId, isActive: true, updatedAt: versions.get(item.id)! }, data: { includesComplimentaryMedia } });
            if(updated.count !== 1) throw new BulkMediaConflict('An activity changed since your review. Review the latest settings before saving.');
          }
          await logAuditEvent({
            client: tx, req, propertyId, action: 'ITEM_BULK_MEDIA_UPDATE', targetType: 'Property', targetId: propertyId,
            details: { includesComplimentaryMedia, changedCount, items: items.map(item => ({ id: item.id, previous: item.includesComplimentaryMedia })) }
          });
        }
        return {
          preview, changedCount, total: items.length, includesComplimentaryMedia,
          items: items.map(item => ({ id: item.id, code: item.code, name: item.name, includesComplimentaryMedia: item.includesComplimentaryMedia, updatedAt: item.updatedAt }))
        };
      });
      return res.json(result);
    } catch(error) {
      if(error instanceof BulkMediaConflict) return res.status(409).json({ error: error.message });
      if(error instanceof CatalogueError) return res.status(400).json({ error: error.message });
      console.error('Bulk media update error:', error);
      return res.status(500).json({ error: 'Could not update the selected activities.' });
    }
  });

  // GET /api/items?propertyId=...

}
