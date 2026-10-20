"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
exports.auditRouter = (0, express_1.Router)();
// GET /api/audit?propertyId=...
exports.auditRouter.get('/', auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, limit = '100' } = req.query;
        const where = {};
        if (propertyId && propertyId !== 'all') {
            where.propertyId = String(propertyId);
        }
        const logs = await db_1.prisma.auditLog.findMany({
            where,
            take: parseInt(String(limit), 10) || 100,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, name: true, email: true, role: true } },
                property: { select: { id: true, name: true, code: true } },
            },
        });
        return res.json({ logs });
    }
    catch (error) {
        console.error('Fetch audit log error:', error);
        return res.status(500).json({ error: 'Failed to fetch audit log.' });
    }
});
