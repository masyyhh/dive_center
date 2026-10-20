"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertiesRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const auditService_1 = require("../services/auditService");
exports.propertiesRouter = (0, express_1.Router)();
// GET /api/properties
// Centre Staff: returns only their assigned centre.
// Property Manager: returns their assigned centres.
// Global Admin: returns all properties.
exports.propertiesRouter.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const userRole = req.user.role;
        let properties = [];
        if (userRole === 'GLOBAL_ADMIN') {
            properties = await db_1.prisma.property.findMany({
                orderBy: { name: 'asc' },
                include: {
                    _count: {
                        select: {
                            bills: true,
                            staffMembers: true,
                        },
                    },
                },
            });
        }
        else {
            properties = await db_1.prisma.property.findMany({
                where: {
                    id: { in: req.user.assignedPropertyIds },
                    isActive: true,
                },
                orderBy: { name: 'asc' },
                include: {
                    _count: {
                        select: {
                            bills: true,
                            staffMembers: true,
                        },
                    },
                },
            });
        }
        return res.json({ properties });
    }
    catch (error) {
        console.error('Fetch properties error:', error);
        return res.status(500).json({ error: 'Failed to fetch properties.' });
    }
});
const propertySchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    code: zod_1.z.string().min(2).max(10),
    location: zod_1.z.string().optional(),
    currency: zod_1.z.string().default('USD'),
    currencySymbol: zod_1.z.string().default('$'),
    taxRate: zod_1.z.number().min(0).max(100).default(16.0),
    serviceChargeRate: zod_1.z.number().min(0).max(100).default(10.0),
    nextCheckNumber: zod_1.z.number().int().positive().default(1001),
});
// POST /api/properties (GLOBAL_ADMIN only)
exports.propertiesRouter.post('/', auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN'), async (req, res) => {
    try {
        const parseResult = propertySchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
        }
        const { name, code, location, currency, currencySymbol, taxRate, serviceChargeRate, nextCheckNumber } = parseResult.data;
        const existing = await db_1.prisma.property.findUnique({ where: { code: code.toUpperCase() } });
        if (existing) {
            return res.status(400).json({ error: `A property with code '${code.toUpperCase()}' already exists.` });
        }
        const property = await db_1.prisma.property.create({
            data: {
                name,
                code: code.toUpperCase(),
                location,
                currency,
                currencySymbol,
                taxRate,
                serviceChargeRate,
                nextCheckNumber,
                categories: {
                    create: [
                        { name: 'Dives', sortOrder: 1 },
                        { name: 'Courses', sortOrder: 2 },
                        { name: 'Photo & Video', sortOrder: 3 },
                        { name: 'Rentals', sortOrder: 4 },
                        { name: 'Retail', sortOrder: 5 },
                    ],
                },
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: property.id,
            action: 'PROPERTY_CREATE',
            targetType: 'Property',
            targetId: property.id,
            details: { name: property.name, code: property.code },
        });
        return res.status(201).json({ property });
    }
    catch (error) {
        console.error('Create property error:', error);
        return res.status(500).json({ error: 'Failed to create property.' });
    }
});
// PUT /api/properties/:id (GLOBAL_ADMIN or PROPERTY_MANAGER)
exports.propertiesRouter.put('/:id', auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, location, currency, currencySymbol, taxRate, serviceChargeRate, nextCheckNumber, isActive } = req.body;
        // Ensure manager has access if not global admin
        if (req.user.role !== 'GLOBAL_ADMIN' && !req.user.assignedPropertyIds.includes(id)) {
            return res.status(403).json({ error: 'Unauthorized to modify this property.' });
        }
        const updated = await db_1.prisma.property.update({
            where: { id },
            data: {
                name: name ?? undefined,
                location: location ?? undefined,
                currency: currency ?? undefined,
                currencySymbol: currencySymbol ?? undefined,
                taxRate: taxRate !== undefined ? Number(taxRate) : undefined,
                serviceChargeRate: serviceChargeRate !== undefined ? Number(serviceChargeRate) : undefined,
                nextCheckNumber: nextCheckNumber !== undefined ? Number(nextCheckNumber) : undefined,
                isActive: isActive !== undefined ? Boolean(isActive) : undefined,
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: updated.id,
            action: 'PROPERTY_UPDATE',
            targetType: 'Property',
            targetId: updated.id,
            details: { name: updated.name },
        });
        return res.json({ property: updated });
    }
    catch (error) {
        console.error('Update property error:', error);
        return res.status(500).json({ error: 'Failed to update property.' });
    }
});
