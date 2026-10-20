"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.itemsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const auditService_1 = require("../services/auditService");
exports.itemsRouter = (0, express_1.Router)();
// GET /api/items?propertyId=...
exports.itemsRouter.get('/', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const propertyId = String(req.query.propertyId);
        const [categories, items] = await Promise.all([
            db_1.prisma.category.findMany({
                where: { propertyId },
                orderBy: { sortOrder: 'asc' },
            }),
            db_1.prisma.item.findMany({
                where: { propertyId, isActive: true },
                include: { category: true },
                orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
            }),
        ]);
        return res.json({ categories, items });
    }
    catch (error) {
        console.error('Fetch items error:', error);
        return res.status(500).json({ error: 'Failed to fetch items catalogue.' });
    }
});
const itemSchema = zod_1.z.object({
    propertyId: zod_1.z.string(),
    categoryId: zod_1.z.string(),
    code: zod_1.z.string().min(1),
    name: zod_1.z.string().min(2),
    price: zod_1.z.number().positive(),
    poolType: zod_1.z.enum(['COURSE_POOL', 'DIVE_POOL', 'NONE']).default('NONE'),
    poolContribution: zod_1.z.number().min(0).default(0.0),
    personalRoles: zod_1.z.string().optional().nullable(),
    personalRatesJson: zod_1.z.string().optional().nullable(),
});
// POST /api/items (GLOBAL_ADMIN or PROPERTY_MANAGER)
exports.itemsRouter.post('/', auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), (0, rbac_1.requirePropertyAccess)('body', 'propertyId'), async (req, res) => {
    try {
        const parseResult = itemSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
        }
        const data = parseResult.data;
        const existing = await db_1.prisma.item.findFirst({
            where: { propertyId: data.propertyId, code: data.code },
        });
        if (existing) {
            return res.status(400).json({ error: `An item with code '${data.code}' already exists in this centre.` });
        }
        const item = await db_1.prisma.item.create({
            data,
            include: { category: true },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: item.propertyId,
            action: 'ITEM_CREATE',
            targetType: 'Item',
            targetId: item.id,
            details: { code: item.code, name: item.name, price: item.price },
        });
        return res.status(201).json({ item });
    }
    catch (error) {
        console.error('Create item error:', error);
        return res.status(500).json({ error: 'Failed to create item.' });
    }
});
// PUT /api/items/:id
exports.itemsRouter.put('/:id', auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await db_1.prisma.item.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Item not found.' });
        }
        if (req.user.role !== 'GLOBAL_ADMIN' && !req.user.assignedPropertyIds.includes(existing.propertyId)) {
            return res.status(403).json({ error: 'Unauthorized for this property.' });
        }
        const { name, price, categoryId, poolType, poolContribution, personalRoles, personalRatesJson, isActive } = req.body;
        const updated = await db_1.prisma.item.update({
            where: { id },
            data: {
                name: name ?? undefined,
                price: price !== undefined ? Number(price) : undefined,
                categoryId: categoryId ?? undefined,
                poolType: poolType ?? undefined,
                poolContribution: poolContribution !== undefined ? Number(poolContribution) : undefined,
                personalRoles: personalRoles !== undefined ? personalRoles : undefined,
                personalRatesJson: personalRatesJson !== undefined ? personalRatesJson : undefined,
                isActive: isActive !== undefined ? Boolean(isActive) : undefined,
            },
            include: { category: true },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: updated.propertyId,
            action: 'ITEM_UPDATE',
            targetType: 'Item',
            targetId: updated.id,
            details: { name: updated.name, price: updated.price },
        });
        return res.json({ item: updated });
    }
    catch (error) {
        console.error('Update item error:', error);
        return res.status(500).json({ error: 'Failed to update item.' });
    }
});
