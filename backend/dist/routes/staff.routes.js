"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const auditService_1 = require("../services/auditService");
exports.staffRouter = (0, express_1.Router)();
// GET /api/staff?propertyId=...&diveStaffOnly=...&activeOnDate=...
exports.staffRouter.get('/', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, diveStaffOnly, activeOnDate } = req.query;
        const where = {
            propertyId: String(propertyId),
            isActive: true,
        };
        if (diveStaffOnly === 'true') {
            where.isDiveStaff = true;
        }
        let staff = await db_1.prisma.staffMember.findMany({
            where,
            orderBy: [{ roleTitle: 'asc' }, { name: 'asc' }],
        });
        if (activeOnDate && typeof activeOnDate === 'string') {
            staff = staff.filter((s) => {
                if (s.hireDate > activeOnDate)
                    return false;
                if (s.leavingDate && s.leavingDate < activeOnDate)
                    return false;
                return true;
            });
        }
        return res.json({ staff });
    }
    catch (error) {
        console.error('Fetch staff error:', error);
        return res.status(500).json({ error: 'Failed to fetch staff members.' });
    }
});
const staffSchema = zod_1.z.object({
    propertyId: zod_1.z.string(),
    name: zod_1.z.string().min(2),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    roleTitle: zod_1.z.string().min(2),
    isDiveStaff: zod_1.z.boolean().default(true),
    isCoursePoolSharing: zod_1.z.boolean().default(false),
    isDivePoolSharing: zod_1.z.boolean().default(true),
    isBaseLeaderOverride: zod_1.z.boolean().default(false),
    hireDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD'),
    leavingDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD').optional().nullable(),
});
// POST /api/staff (GLOBAL_ADMIN or PROPERTY_MANAGER)
exports.staffRouter.post('/', auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), (0, rbac_1.requirePropertyAccess)('body', 'propertyId'), async (req, res) => {
    try {
        const parseResult = staffSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
        }
        const data = parseResult.data;
        const staff = await db_1.prisma.staffMember.create({
            data: {
                ...data,
                email: data.email || null,
                leavingDate: data.leavingDate || null,
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: staff.propertyId,
            action: 'STAFF_CREATE',
            targetType: 'StaffMember',
            targetId: staff.id,
            details: { name: staff.name, role: staff.roleTitle },
        });
        return res.status(201).json({ staff });
    }
    catch (error) {
        console.error('Create staff error:', error);
        return res.status(500).json({ error: 'Failed to create staff member.' });
    }
});
// PUT /api/staff/:id
exports.staffRouter.put('/:id', auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await db_1.prisma.staffMember.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Staff member not found.' });
        }
        // Check property access
        if (req.user.role !== 'GLOBAL_ADMIN' && !req.user.assignedPropertyIds.includes(existing.propertyId)) {
            return res.status(403).json({ error: 'Unauthorized for this property.' });
        }
        const { name, email, roleTitle, isDiveStaff, isCoursePoolSharing, isDivePoolSharing, isBaseLeaderOverride, hireDate, leavingDate, isActive, } = req.body;
        const updated = await db_1.prisma.staffMember.update({
            where: { id },
            data: {
                name: name ?? undefined,
                email: email !== undefined ? (email ? email : null) : undefined,
                roleTitle: roleTitle ?? undefined,
                isDiveStaff: isDiveStaff !== undefined ? Boolean(isDiveStaff) : undefined,
                isCoursePoolSharing: isCoursePoolSharing !== undefined ? Boolean(isCoursePoolSharing) : undefined,
                isDivePoolSharing: isDivePoolSharing !== undefined ? Boolean(isDivePoolSharing) : undefined,
                isBaseLeaderOverride: isBaseLeaderOverride !== undefined ? Boolean(isBaseLeaderOverride) : undefined,
                hireDate: hireDate ?? undefined,
                leavingDate: leavingDate !== undefined ? (leavingDate ? leavingDate : null) : undefined,
                isActive: isActive !== undefined ? Boolean(isActive) : undefined,
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId: updated.propertyId,
            action: 'STAFF_UPDATE',
            targetType: 'StaffMember',
            targetId: updated.id,
            details: { name: updated.name, roleTitle: updated.roleTitle },
        });
        return res.json({ staff: updated });
    }
    catch (error) {
        console.error('Update staff error:', error);
        return res.status(500).json({ error: 'Failed to update staff member.' });
    }
});
