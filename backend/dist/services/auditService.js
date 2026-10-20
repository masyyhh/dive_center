"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAuditEvent = void 0;
const db_1 = require("../db");
const logAuditEvent = async ({ req, propertyId, userId, action, targetType, targetId, details, }) => {
    try {
        const effectiveUserId = userId || req?.user?.id || null;
        const effectivePropertyId = propertyId ||
            req?.headers['x-property-id'] ||
            req?.query?.propertyId ||
            req?.body?.propertyId ||
            null;
        const ipAddress = req?.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
            req?.socket?.remoteAddress ||
            '127.0.0.1';
        await db_1.prisma.auditLog.create({
            data: {
                propertyId: effectivePropertyId,
                userId: effectiveUserId,
                action,
                targetType,
                targetId: targetId ? String(targetId) : null,
                details: details ? JSON.stringify(details) : null,
                ipAddress,
            },
        });
    }
    catch (err) {
        console.error('Failed to write audit log:', err);
    }
};
exports.logAuditEvent = logAuditEvent;
