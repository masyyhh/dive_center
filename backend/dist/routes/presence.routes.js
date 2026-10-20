"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.presenceRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const auditService_1 = require("../services/auditService");
exports.presenceRouter = (0, express_1.Router)();
// GET /api/presence/month-status?propertyId=...&yearMonth=... (e.g. 2026-10)
exports.presenceRouter.get('/month-status', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, yearMonth } = req.query;
        if (!yearMonth || !/^\d{4}-\d{2}$/.test(String(yearMonth))) {
            return res.status(400).json({ error: 'Valid yearMonth (YYYY-MM) is required.' });
        }
        const ym = String(yearMonth);
        const startDate = `${ym}-01`;
        // Find last day of month
        const [year, month] = ym.split('-').map(Number);
        const lastDayNum = new Date(year, month, 0).getDate();
        const endDate = `${ym}-${String(lastDayNum).padStart(2, '0')}`;
        // Active dive staff for this property
        const diveStaff = await db_1.prisma.staffMember.findMany({
            where: {
                propertyId: String(propertyId),
                isDiveStaff: true,
                isActive: true,
            },
        });
        // Attendance records for this month
        const attendances = await db_1.prisma.attendance.findMany({
            where: {
                propertyId: String(propertyId),
                date: { gte: startDate, lte: endDate },
            },
        });
        const attMapByDate = new Map();
        for (const a of attendances) {
            const list = attMapByDate.get(a.date) || [];
            list.push(a);
            attMapByDate.set(a.date, list);
        }
        const todayStr = new Date().toISOString().substring(0, 10);
        const dayStatuses = {};
        let missingDaysCount = 0;
        for (let d = 1; d <= lastDayNum; d++) {
            const dateStr = `${ym}-${String(d).padStart(2, '0')}`;
            // Determine how many dive staff were employed on this specific date
            // (PDF Page 5: "Staff appear from their hire date and drop off after their leaving date")
            const employedStaffToday = diveStaff.filter((s) => {
                if (s.hireDate > dateStr)
                    return false;
                if (s.leavingDate && s.leavingDate < dateStr)
                    return false;
                return true;
            });
            const marked = attMapByDate.get(dateStr) || [];
            const expectedCount = employedStaffToday.length;
            const markedCount = marked.length;
            if (dateStr > todayStr) {
                dayStatuses[dateStr] = { status: 'future', markedCount, expectedCount };
            }
            else if (markedCount === 0 && expectedCount > 0) {
                dayStatuses[dateStr] = { status: 'missing', markedCount, expectedCount };
                // Past day with nothing recorded
                if (dateStr < todayStr) {
                    missingDaysCount++;
                }
            }
            else if (markedCount >= expectedCount && expectedCount > 0) {
                dayStatuses[dateStr] = { status: 'recorded', markedCount, expectedCount };
            }
            else {
                dayStatuses[dateStr] = { status: 'partial', markedCount, expectedCount };
            }
        }
        return res.json({
            yearMonth: ym,
            dayStatuses,
            missingDaysCount,
        });
    }
    catch (error) {
        console.error('Fetch month status error:', error);
        return res.status(500).json({ error: 'Failed to calculate presence calendar status.' });
    }
});
// GET /api/presence/day?propertyId=...&date=...
exports.presenceRouter.get('/day', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('query', 'propertyId'), async (req, res) => {
    try {
        const { propertyId, date } = req.query;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
        }
        const dateStr = String(date);
        const propId = String(propertyId);
        // Only dive staff employed on this day
        const allDiveStaff = await db_1.prisma.staffMember.findMany({
            where: {
                propertyId: propId,
                isDiveStaff: true,
                isActive: true,
            },
            orderBy: [{ roleTitle: 'asc' }, { name: 'asc' }],
        });
        const employedStaff = allDiveStaff.filter((s) => {
            if (s.hireDate > dateStr)
                return false;
            if (s.leavingDate && s.leavingDate < dateStr)
                return false;
            return true;
        });
        const attendances = await db_1.prisma.attendance.findMany({
            where: {
                propertyId: propId,
                date: dateStr,
            },
        });
        const attMap = new Map(attendances.map((a) => [a.staffMemberId, a]));
        const result = employedStaff.map((staff) => {
            const att = attMap.get(staff.id);
            return {
                staffMemberId: staff.id,
                staffName: staff.name,
                roleTitle: staff.roleTitle,
                isCoursePoolSharing: staff.isCoursePoolSharing,
                isDivePoolSharing: staff.isDivePoolSharing,
                isBaseLeaderOverride: staff.isBaseLeaderOverride,
                status: att ? att.status : 'PRESENT',
                note: att?.note || '',
                isSaved: Boolean(att),
            };
        });
        return res.json({ date: dateStr, staff: result });
    }
    catch (error) {
        console.error('Fetch day attendance error:', error);
        return res.status(500).json({ error: 'Failed to fetch day attendance.' });
    }
});
const saveDayPresenceSchema = zod_1.z.object({
    propertyId: zod_1.z.string(),
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    records: zod_1.z.array(zod_1.z.object({
        staffMemberId: zod_1.z.string(),
        status: zod_1.z.enum([
            'PRESENT',
            'OFF',
            'OFF_HALF',
            'ANNUAL_LEAVE',
            'SICK',
            'ABSENT',
            'EMERGENCY_LEAVE',
        ]),
        note: zod_1.z.string().optional().nullable(),
    })),
});
// POST /api/presence/day
// PDF Page 5: Save attendance for a day (with support for 'All present')
exports.presenceRouter.post('/day', auth_1.requireAuth, (0, rbac_1.requirePropertyAccess)('body', 'propertyId'), async (req, res) => {
    try {
        const parseResult = saveDayPresenceSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ error: 'Validation failed', details: parseResult.error.errors });
        }
        const { propertyId, date, records } = parseResult.data;
        // Check if month is locked for payroll
        const yearMonth = date.substring(0, 7);
        const lock = await db_1.prisma.monthLock.findUnique({
            where: { propertyId_yearMonth: { propertyId, yearMonth } },
        });
        if (lock && lock.isLocked) {
            return res.status(423).json({
                error: `Cannot modify attendance: The month (${yearMonth}) is locked for payroll.`,
            });
        }
        // Upsert each record
        await db_1.prisma.$transaction(records.map((r) => db_1.prisma.attendance.upsert({
            where: {
                propertyId_staffMemberId_date: {
                    propertyId,
                    staffMemberId: r.staffMemberId,
                    date,
                },
            },
            create: {
                propertyId,
                staffMemberId: r.staffMemberId,
                date,
                status: r.status,
                note: r.note || null,
            },
            update: {
                status: r.status,
                note: r.note || null,
            },
        })));
        await (0, auditService_1.logAuditEvent)({
            req,
            propertyId,
            action: 'ATTENDANCE_UPDATE',
            targetType: 'Attendance',
            targetId: date,
            details: { date, count: records.length },
        });
        return res.json({ message: 'Attendance recorded successfully.', date, count: records.length });
    }
    catch (error) {
        console.error('Save presence error:', error);
        return res.status(500).json({ error: 'Failed to record attendance.' });
    }
});
