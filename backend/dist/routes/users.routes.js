"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const auditService_1 = require("../services/auditService");
exports.usersRouter = (0, express_1.Router)();
// All user management routes require GLOBAL_ADMIN
exports.usersRouter.use(auth_1.requireAuth, (0, rbac_1.requireRole)('GLOBAL_ADMIN'));
// GET /api/users
exports.usersRouter.get('/', async (req, res) => {
    try {
        const users = await db_1.prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                failedLoginAttempts: true,
                lockedUntil: true,
                isActive: true,
                createdAt: true,
                assignedProperties: {
                    include: {
                        property: {
                            select: { id: true, name: true, code: true },
                        },
                    },
                },
            },
        });
        return res.json({ users });
    }
    catch (error) {
        console.error('Fetch users error:', error);
        return res.status(500).json({ error: 'Failed to fetch users.' });
    }
});
const createUserSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    name: zod_1.z.string().min(2),
    password: zod_1.z.string().min(6, 'Password must be at least 6 characters long'),
    role: zod_1.z.enum(['GLOBAL_ADMIN', 'PROPERTY_MANAGER', 'CENTRE_STAFF']),
    propertyIds: zod_1.z.array(zod_1.z.string()).optional(),
});
// POST /api/users
exports.usersRouter.post('/', async (req, res) => {
    try {
        const parseResult = createUserSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
        }
        const { email, name, password, role, propertyIds } = parseResult.data;
        const existing = await db_1.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (existing) {
            return res.status(400).json({ error: `User with email '${email}' already exists.` });
        }
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        const user = await db_1.prisma.user.create({
            data: {
                email: email.toLowerCase(),
                name,
                passwordHash,
                role,
                assignedProperties: {
                    create: (propertyIds || []).map((propertyId) => ({ propertyId })),
                },
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                createdAt: true,
                assignedProperties: {
                    include: { property: true },
                },
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            userId: req.user.id,
            action: 'USER_CREATE',
            targetType: 'User',
            targetId: user.id,
            details: { email: user.email, role: user.role },
        });
        return res.status(201).json({ user });
    }
    catch (error) {
        console.error('Create user error:', error);
        return res.status(500).json({ error: 'Failed to create user.' });
    }
});
// PUT /api/users/:id
exports.usersRouter.put('/:id', async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, role, propertyIds, isActive } = req.body;
        const existing = await db_1.prisma.user.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'User not found.' });
        }
        // Update basic fields
        await db_1.prisma.user.update({
            where: { id },
            data: {
                name: name ?? undefined,
                role: role ?? undefined,
                isActive: isActive !== undefined ? Boolean(isActive) : undefined,
            },
        });
        // If propertyIds provided, update relations
        if (Array.isArray(propertyIds)) {
            await db_1.prisma.userProperty.deleteMany({ where: { userId: id } });
            await db_1.prisma.userProperty.createMany({
                data: propertyIds.map((propertyId) => ({ userId: id, propertyId })),
            });
        }
        const updated = await db_1.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                assignedProperties: {
                    include: { property: true },
                },
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            userId: req.user.id,
            action: 'USER_UPDATE',
            targetType: 'User',
            targetId: id,
            details: { updatedFields: { name, role, isActive, propertyIds } },
        });
        return res.json({ user: updated });
    }
    catch (error) {
        console.error('Update user error:', error);
        return res.status(500).json({ error: 'Failed to update user.' });
    }
});
// POST /api/users/:id/reset-password
// Admin sets new password (PDF Page 2: "Passwords are set by your administrator")
exports.usersRouter.post('/:id/reset-password', async (req, res) => {
    try {
        const id = String(req.params.id);
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        }
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        await db_1.prisma.user.update({
            where: { id },
            data: {
                passwordHash,
                failedLoginAttempts: 0,
                lockedUntil: null,
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            userId: req.user.id,
            action: 'PASSWORD_RESET',
            targetType: 'User',
            targetId: id,
            details: { message: 'Password reset by administrator' },
        });
        return res.json({ message: 'Password updated successfully. Account lock has been cleared.' });
    }
    catch (error) {
        console.error('Reset password error:', error);
        return res.status(500).json({ error: 'Failed to reset password.' });
    }
});
// POST /api/users/:id/unlock
// Admin manually unlocks a locked account
exports.usersRouter.post('/:id/unlock', async (req, res) => {
    try {
        const id = String(req.params.id);
        await db_1.prisma.user.update({
            where: { id },
            data: {
                failedLoginAttempts: 0,
                lockedUntil: null,
            },
        });
        await (0, auditService_1.logAuditEvent)({
            req,
            userId: req.user.id,
            action: 'ACCOUNT_UNLOCKED',
            targetType: 'User',
            targetId: id,
            details: { message: 'Account manually unlocked by administrator' },
        });
        return res.json({ message: 'Account unlocked successfully.' });
    }
    catch (error) {
        console.error('Unlock user error:', error);
        return res.status(500).json({ error: 'Failed to unlock account.' });
    }
});
