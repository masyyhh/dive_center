"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = exports.signToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const JWT_SECRET = process.env.JWT_SECRET || 'dive-center-default-secret-change-in-prod';
const signToken = (payload) => {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, {
        expiresIn: (process.env.JWT_EXPIRES_IN || '12h'),
    });
};
exports.signToken = signToken;
const requireAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required. Please sign in.' });
        }
        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        }
        catch (err) {
            return res.status(401).json({ error: 'Session expired or invalid token. Please sign in again.' });
        }
        const user = await db_1.prisma.user.findUnique({
            where: { id: decoded.id },
            include: {
                assignedProperties: {
                    select: { propertyId: true },
                },
            },
        });
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'User account is inactive or no longer exists.' });
        }
        // Check account lockout
        if (user.lockedUntil && user.lockedUntil > new Date()) {
            const minutesRemaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / (60 * 1000));
            return res.status(423).json({
                error: `Account is temporarily locked. Please try again in ${minutesRemaining} minutes or contact your administrator.`,
            });
        }
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            assignedPropertyIds: user.assignedProperties.map((p) => p.propertyId),
        };
        next();
    }
    catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: 'Internal server error during authentication.' });
    }
};
exports.requireAuth = requireAuth;
