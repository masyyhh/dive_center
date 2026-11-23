import { Router, Request, Response } from 'express';
import type { Prisma, TankSession } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { withPropertyPayrollTransaction } from '../utils/payrollTransaction';
import { isMonthLocked } from './bill.payroll';
import { businessMonth, businessToday, isBusinessDate } from '../utils/dates';
import { tripPayroll, tripPayrollCsv, tripPayrollWorkbook } from '../services/tripPayroll';
import { calculateTankCommission, equalTankTripConfig, tankParticipantSchema, tankRuleConfigSchema } from '../utils/tankCommission';
import { tripsAvailable, tripsStartDate } from '../utils/tripsAvailability';

export const tankRouter = Router();
tankRouter.use(requireAuth);
tankRouter.use((req, res, next) => {
  const propertyId = req.method === 'GET' ? req.query.propertyId : req.body?.propertyId;
  if (!tripsAvailable(propertyId)) return res.status(404).json({ error: 'Trips & Tanks is unavailable at this property.' });
  next();
});
const managers = requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER');
const id = z.string().trim().min(1).max(100);
const label = z.string().trim().min(1).max(100);
const date = z.string().refine(isBusinessDate, 'Enter a valid date.');
const version = z.number().int().positive();
const ruleSchema = z.object({
  propertyId: id, name: label, activityType: label, boatId: id.nullable(),
  effectiveFrom: date, effectiveTo: date.nullable(), isActive: z.boolean(),
  config: tankRuleConfigSchema, version: version.optional(),
}).strict().refine(rule => !rule.effectiveTo || rule.effectiveTo >= rule.effectiveFrom, 'The end date must follow the start date.');
const count = z.number().int().min(0).max(100000);
const sessionSchema = z.object({
  propertyId: id, requestId: z.string().uuid(), businessDate: date,
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  activityType: label, boatId: id.nullable(), siteIds: z.array(id).max(10),
  tanks: count, passengers: count, dives: count, gearWash: count,
  isComplimentary: z.boolean(), isTraining: z.boolean(),
  manualTotalCents: z.number().int().min(0).max(2000000000).nullable(),
  participants: z.array(tankParticipantSchema).max(50), ruleId: id.nullable(),
  override: tankRuleConfigSchema.nullable(), overrideReason: z.string().trim().max(1000).nullable(),
  notes: z.string().trim().max(2000).nullable(), version: version.optional(),
  finalize: z.boolean().optional(), ruleVersion: version.optional(),
  correctionReason: z.string().trim().min(3).max(1000).optional(),
}).strict();

class TankError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new TankError(status, message); };
const manager = (req: Request) => ['GLOBAL_ADMIN', 'PROPERTY_MANAGER'].includes(req.user!.role);
const route = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    if (error instanceof TankError) return res.status(error.status).json({ error: error.message });
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'This name or submission already exists. Refresh the register before retrying.' });
    console.error('Tank commission error:', error);
    return res.status(500).json({ error: 'Could not complete the tank commission request.' });
  }
};
async function activeProperty(tx: Prisma.TransactionClient, propertyId: string) {
  const property = await tx.property.findUnique({ where: { id: propertyId } });
  if (!property || !property.isActive || property.deletedAt) fail(404, 'Select an active property.');
}
async function audit(tx: Prisma.TransactionClient, req: Request, propertyId: string, action: string, targetId: string, details: object) {
  await tx.auditLog.create({ data: { propertyId, userId: req.user!.id, action, targetType: 'TankCommission', targetId, details: JSON.stringify(details), ipAddress: req.ip } });
}
async function canChangeRules(tx: Prisma.TransactionClient, req: Request, propertyId: string) {
  const settings = await tx.tankCommissionSettings.findUnique({ where: { propertyId } });
  if (settings?.restricted && req.user!.role !== 'GLOBAL_ADMIN') fail(403, 'Commission rules are confirmed. A global administrator must change or unlock them.');
}
async function resource(tx: Prisma.TransactionClient, propertyId: string, resourceId: string, kind: string) {
  const row = await tx.tankResource.findFirst({ where: { id: resourceId, propertyId, kind, isActive: true } });
  if (!row) fail(400, `Select an active ${kind === 'BOAT' ? 'boat' : 'dive site'} from this property.`);
  return row!;
}
const ruleView = (row: { configJson: string } & Record<string, unknown>) => { const { configJson, ...rest } = row; return { ...rest, config: JSON.parse(configJson) }; };
const sessionView = (row: TankSession) => {
  const { participantsJson, diveSitesJson, snapshotJson, overrideJson, ...rest } = row;
  return { ...rest, participants: JSON.parse(participantsJson), diveSites: JSON.parse(diveSitesJson), snapshot: snapshotJson ? JSON.parse(snapshotJson) : null, override: overrideJson ? JSON.parse(overrideJson) : null };
};

async function calculateSession(tx: Prisma.TransactionClient, req: Request, current: TankSession, action: 'preview' | 'approve' | 'save', expectedRuleVersion?: number, includeAdditionalCrew = false) {
  const data = { propertyId: current.propertyId, ruleVersion: expectedRuleVersion };
  if (current.businessDate < tripsStartDate) fail(400, 'Trip date is before the Trips & Tanks rollout.');
  const fixed = action === 'save';
  if (!fixed && !current.ruleId) fail(400, 'Commission setup required: choose a configured rule.');
  const rule = fixed ? null : await tx.tankCommissionRule.findFirst({ where: { id: current.ruleId!, propertyId: data.propertyId, isActive: true } });
  if (!fixed && (!rule || rule.activityType !== current.activityType || rule.boatId && rule.boatId !== current.boatId || rule.effectiveFrom > current.businessDate || rule.effectiveTo && rule.effectiveTo < current.businessDate)) fail(400, 'Choose an active rule matching this activity, boat and date.');
  if (action !== 'preview' && current.businessDate > businessToday()) fail(400, 'Future trips cannot be included in payroll.');
  if (action === 'approve' && data.ruleVersion !== rule!.version) fail(409, 'Commission rules changed or were not confirmed. Refresh the register before saving.');
  if (action === 'approve' && current.overrideJson) {
    await canChangeRules(tx, req, data.propertyId);
    if (!tankRuleConfigSchema.parse(JSON.parse(rule!.configJson)).allowOverrides) fail(403, 'This rule no longer allows session overrides.');
  }
  const participants = z.array(tankParticipantSchema).parse(JSON.parse(current.participantsJson));
  const staff = await tx.staffMember.findMany({ where: { propertyId: data.propertyId, isActive: true, id: { in: participants.map(person => person.staffId) }, hireDate: { lte: current.businessDate }, OR: [{ leavingDate: null }, { leavingDate: { gte: current.businessDate } }] } });
  if (staff.length !== participants.length) fail(400, 'Review recipients: an employee is no longer eligible for this session date.');
  let config;
  try { config = fixed ? equalTankTripConfig(participants) : tankRuleConfigSchema.parse(JSON.parse(current.overrideJson ?? rule!.configJson)); }
  catch (error) { fail(400, error instanceof Error ? error.message : 'Select valid crew.'); }
  const appliedConfig = config!;
  // Additional people use the configured per-role payment or sharing weight.
  // Percentage rules retain their fixed slots so percentages cannot exceed 100%.
  if (includeAdditionalCrew && appliedConfig.distribution !== 'PERCENTAGE') {
    appliedConfig.roles = appliedConfig.roles.map(role => ({ ...role, slots: Math.max(role.slots, participants.filter(person => person.role === role.name).length) }));
  }
  let calculation;
  try { calculation = calculateTankCommission(appliedConfig, current, participants, true); }
  catch (error) { fail(400, error instanceof Error ? error.message : 'Invalid commission setup.'); }
  const preview = { ...calculation!, remainderPolicy: 'STAFF_ID', ruleId: fixed ? null : rule!.id, ruleName: fixed ? 'Tanks ÷ assigned staff' : rule!.name, ruleVersion: fixed ? 1 : rule!.version, config: appliedConfig, calculationMode: fixed ? 'TANK_EQUAL' : 'LEGACY_RULE', staffCount: participants.length, overrideReason: current.overrideReason,
    allocations: calculation!.allocations.map(allocation => { const member = staff.find(person => person.id === allocation.staffId)!; return { ...allocation, staffName: member.name, staffRoleTitle: member.roleTitle }; }) };
  if (action === 'preview') return { preview };
  const updated = await tx.tankSession.update({ where: { id: current.id }, data: { status: 'APPROVED', totalCents: preview.totalCents, unallocatedCents: preview.unallocatedCents, snapshotJson: JSON.stringify(preview), approvedAt: new Date(), approvedById: req.user!.id, version: { increment: 1 } } });
  await tx.tankCommissionAllocation.createMany({ data: preview.allocations.map(allocation => ({ ...allocation, sessionId: current.id })) });
  await audit(tx, req, data.propertyId, action === 'save' ? 'TANK_SESSION_SAVE' : 'TANK_SESSION_APPROVE', current.id, { snapshot: preview });
  return { session: sessionView(updated), preview };
}

tankRouter.get('/setup', requirePropertyAccess('query'), route(async (req, res) => {
  const propertyId = String(req.query.propertyId);
  await activeProperty(prisma, propertyId);
  const [settings, rules, resources, staff] = await Promise.all([
    prisma.tankCommissionSettings.findUnique({ where: { propertyId } }),
    prisma.tankCommissionRule.findMany({ where: { propertyId }, orderBy: [{ effectiveFrom: 'desc' }, { name: 'asc' }] }),
    prisma.tankResource.findMany({ where: { propertyId }, orderBy: { name: 'asc' } }),
    prisma.staffMember.findMany({ where: { propertyId, isActive: true }, select: { id: true, name: true, roleTitle: true, erNumber: true, hireDate: true, leavingDate: true }, orderBy: { name: 'asc' } }),
  ]);
  res.json({ settings: settings ?? { propertyId, restricted: false, version: 0 }, rules: rules.map(ruleView), resources, staff });
}));

tankRouter.put('/settings', requireRole('GLOBAL_ADMIN'), requirePropertyAccess('body'), route(async (req, res) => {
  const data = z.object({ propertyId: id, restricted: z.boolean(), version: z.number().int().min(0), reason: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
  const result = await withPropertyPayrollTransaction(prisma, data.propertyId, async tx => {
    await activeProperty(tx, data.propertyId);
    const current = await tx.tankCommissionSettings.findUnique({ where: { propertyId: data.propertyId } });
    if ((current?.version ?? 0) !== data.version) fail(409, 'Settings changed. Refresh before saving.');
    const settings = await tx.tankCommissionSettings.upsert({ where: { propertyId: data.propertyId }, create: { propertyId: data.propertyId, restricted: data.restricted }, update: { restricted: data.restricted, version: { increment: 1 } } });
    await audit(tx, req, data.propertyId, 'TANK_SETTINGS_UPDATE', data.propertyId, { before: current, after: settings, reason: data.reason });
    return settings;
  });
  res.json({ settings: result });
}));

// Boats and sites remain maintainable after rates are confirmed; they do not change saved payouts.
tankRouter.post('/resources', managers, requirePropertyAccess('body'), route(async (req, res) => {
  const data = z.object({ propertyId: id, kind: z.enum(['BOAT', 'SITE']), name: label }).strict().parse(req.body);
  const result = await withPropertyPayrollTransaction(prisma, data.propertyId, async tx => {
    await activeProperty(tx, data.propertyId);
    const row = await tx.tankResource.create({ data: { ...data, normalizedName: data.name.toLocaleLowerCase('en').replace(/\s+/g, ' ') } });
    await audit(tx, req, data.propertyId, 'TANK_RESOURCE_CREATE', row.id, row);
    return row;
  });
  res.status(201).json({ resource: result });
}));
tankRouter.put('/resources/:id', managers, requirePropertyAccess('body'), route(async (req, res) => {
  const data = z.object({ propertyId: id, isActive: z.boolean() }).strict().parse(req.body);
  const result = await withPropertyPayrollTransaction(prisma, data.propertyId, async tx => {
    await activeProperty(tx, data.propertyId);
    const row = await tx.tankResource.findFirst({ where: { id: String(req.params.id), propertyId: data.propertyId } });
    if (!row) fail(404, 'Boat or dive site not found.');
    const updated = await tx.tankResource.update({ where: { id: row!.id }, data: { isActive: data.isActive } });
    await audit(tx, req, data.propertyId, 'TANK_RESOURCE_UPDATE', row!.id, { isActive: data.isActive });
    return updated;
  });
  res.json({ resource: result });
}));

for (const method of ['post', 'put'] as const) tankRouter[method](method === 'post' ? '/rules' : '/rules/:id', managers, requirePropertyAccess('body'), route(async (req, res) => {
  const data = ruleSchema.parse(req.body);
  const result = await withPropertyPayrollTransaction(prisma, data.propertyId, async tx => {
    await activeProperty(tx, data.propertyId);
    await canChangeRules(tx, req, data.propertyId);
    if (data.boatId) await resource(tx, data.propertyId, data.boatId, 'BOAT');
    const { config, version: expectedVersion, ...fields } = data;
    const before = method === 'put' ? await tx.tankCommissionRule.findFirst({ where: { id: String(req.params.id), propertyId: data.propertyId } }) : null;
    if (method === 'put' && !before) fail(404, 'Rule not found.');
    if (before && before.version !== expectedVersion) fail(409, 'This rule changed. Refresh before saving.');
    const rule = before ? await tx.tankCommissionRule.update({ where: { id: before.id }, data: { ...fields, configJson: JSON.stringify(config), version: { increment: 1 } } })
      : await tx.tankCommissionRule.create({ data: { ...fields, configJson: JSON.stringify(config) } });
    await audit(tx, req, data.propertyId, before ? 'TANK_RULE_UPDATE' : 'TANK_RULE_CREATE', rule.id, { before, after: rule });
    return rule;
  });
  res.status(method === 'post' ? 201 : 200).json({ rule: ruleView(result) });
}));

tankRouter.get('/sessions', requirePropertyAccess('query'), route(async (req, res) => {
  const month = businessMonth(String(req.query.yearMonth));
  if (!month) fail(400, 'Choose a valid month.');
  if (req.query.cursor !== undefined && (typeof req.query.cursor !== 'string' || req.query.cursor.length > 100)) fail(400, 'Invalid page cursor.');
  const propertyId = String(req.query.propertyId);
  const sessions = await prisma.tankSession.findMany({
    where: { propertyId, businessDate: { gte: month!.start, lte: month!.end }, ...(req.query.cursor ? { id: { gt: String(req.query.cursor) } } : {}) },
    orderBy: { id: 'asc' }, take: 101,
  });
  const lock = await prisma.monthLock.findUnique({ where: { propertyId_yearMonth: { propertyId, yearMonth: String(req.query.yearMonth) } } });
  res.json({ sessions: sessions.slice(0, 100).map(sessionView), nextCursor: sessions.length > 100 ? sessions[99].id : null, isLocked: lock?.isLocked ?? false });
}));

// Staff summaries are grouped from the same saved allocation rows used by payroll.
for (const endpoint of ['/payroll', '/payroll/export']) tankRouter.get(endpoint, managers, requirePropertyAccess('query'), route(async (req, res) => {
  const data = z.object({ propertyId: id, startDate: date, endDate: date, format: z.enum(['csv', 'xlsx']).optional() }).parse(req.query);
  if (data.endDate < data.startDate || (Date.parse(data.endDate) - Date.parse(data.startDate)) / 86400000 >= 366) fail(400, 'Choose a valid date range of up to 366 days.');
  await activeProperty(prisma, data.propertyId);
  const report = await tripPayroll(data.propertyId, data.startDate, data.endDate);
  if (endpoint === '/payroll') return res.json(report);
  const format = data.format ?? 'xlsx';
  res.setHeader('Content-Disposition', `attachment; filename="Trip_Payroll_${data.startDate}_${data.endDate}.${format}"`);
  if (format === 'csv') return res.type('text/csv; charset=utf-8').send(tripPayrollCsv(report));
  const property = await prisma.property.findUniqueOrThrow({ where: { id: data.propertyId }, select: { name: true, currency: true } });
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await tripPayrollWorkbook(report, property));
}));

for (const method of ['post', 'put'] as const) tankRouter[method](method === 'post' ? '/sessions' : '/sessions/:id', requirePropertyAccess('body'), route(async (req, res) => {
  const data = sessionSchema.parse(req.body);
  if (data.businessDate < tripsStartDate) fail(400, 'Trip date is before the Trips & Tanks rollout.');
  // Older clients can explicitly retain a draft; ordinary saves calculate payments directly.
  const savePayments = data.finalize !== false;
  const result = await withPropertyPayrollTransaction(prisma, data.propertyId, async tx => {
    await activeProperty(tx, data.propertyId);
    const before = method === 'put' ? await tx.tankSession.findFirst({ where: { id: String(req.params.id), propertyId: data.propertyId } }) : null;
    if (method === 'put' && !before) fail(404, 'Session not found.');
    if (before && (before.status === 'VOID' || before.version !== data.version)) fail(409, 'Only the latest non-void trip can be edited. Refresh the register.');
    const correcting = before?.status === 'APPROVED';
    if (correcting && !manager(req)) fail(403, 'Only administrators can edit saved trip logs.');
    if (correcting && (!data.correctionReason || !savePayments)) fail(400, 'Enter a correction reason to recalculate this saved trip.');
    if (before && !manager(req) && before.createdById !== req.user!.id) fail(403, 'You can edit only your own draft sessions.');
    if (await isMonthLocked(tx, data.propertyId, data.businessDate) || before && await isMonthLocked(tx, data.propertyId, before.businessDate)) fail(423, 'This payroll month is locked.');
    if (before && before.requestId !== data.requestId) fail(400, 'The session submission ID cannot change.');
    const boat = data.boatId ? await resource(tx, data.propertyId, data.boatId, 'BOAT') : null;
    const sites = await Promise.all([...new Set(data.siteIds)].map(siteId => resource(tx, data.propertyId, siteId, 'SITE')));
    if (new Set(data.participants.map(person => person.staffId)).size !== data.participants.length) fail(400, 'Select each employee only once.');
    const staff = await tx.staffMember.findMany({ where: { propertyId: data.propertyId, isActive: true, id: { in: data.participants.map(person => person.staffId) }, hireDate: { lte: data.businessDate }, OR: [{ leavingDate: null }, { leavingDate: { gte: data.businessDate } }] } });
    if (staff.length !== data.participants.length) fail(400, 'Recipients must be employed at this property on the session date.');
    const rule = !savePayments && data.ruleId ? await tx.tankCommissionRule.findFirst({ where: { id: data.ruleId, propertyId: data.propertyId } }) : null;
    if (!savePayments && data.ruleId && !rule) fail(400, 'Choose a rule from this property.');
    if (!savePayments && data.override) {
      await canChangeRules(tx, req, data.propertyId);
      if (!manager(req) || !rule || !tankRuleConfigSchema.parse(JSON.parse(rule.configJson)).allowOverrides || !data.overrideReason || data.overrideReason.length < 3) fail(403, 'A permitted manager override needs a rule that allows overrides and a reason.');
    }
    if (!savePayments && before?.overrideJson && !manager(req)) fail(403, 'A manager must edit sessions with commission overrides.');
    const { propertyId, participants, siteIds: _sites, override, version: _version, finalize, ruleVersion, correctionReason, ...fields } = data;
    const values = { ...fields, ...(savePayments ? { ruleId: null, manualTotalCents: null, overrideReason: null } : {}), boatName: boat?.name ?? null, diveSitesJson: JSON.stringify(sites.map(site => ({ id: site.id, name: site.name }))), participantsJson: JSON.stringify(participants), overrideJson: !savePayments && override ? JSON.stringify(override) : null };
    const session = before ? await tx.tankSession.update({ where: { id: before.id }, data: { ...values, version: { increment: 1 } } })
      : await tx.tankSession.create({ data: { ...values, propertyId, createdById: req.user!.id } });
    await tx.tankSessionSite.deleteMany({ where: { sessionId: session.id } });
    if (sites.length) await tx.tankSessionSite.createMany({ data: sites.map((site, position) => ({ sessionId: session.id, siteId: site.id, position })) });
    if (!correcting) await audit(tx, req, propertyId, before ? 'TANK_SESSION_UPDATE' : 'TANK_SESSION_CREATE', session.id, { before, after: session });
    if (savePayments) {
      if (!session.departureTime) fail(400, 'Confirm the departure time before saving the trip log.');
      const previousAllocations = correcting ? await tx.tankCommissionAllocation.findMany({ where: { sessionId: session.id } }) : [];
      if (correcting) await tx.tankCommissionAllocation.deleteMany({ where: { sessionId: session.id } });
      const saved = (await calculateSession(tx, req, session, 'save', ruleVersion ?? rule?.version, true)).session!;
      if (correcting) {
        const allocations = await tx.tankCommissionAllocation.findMany({ where: { sessionId: session.id } });
        await audit(tx, req, propertyId, 'TANK_SESSION_CORRECT', session.id, {
          reason: correctionReason, before: { session: before, allocations: previousAllocations },
          after: { session: await tx.tankSession.findUnique({ where: { id: session.id } }), allocations },
        });
      }
      return saved;
    }
    return sessionView(session);
  });
  res.status(method === 'post' ? 201 : 200).json({ session: result });
}));

for (const action of ['preview', 'approve', 'reopen', 'void'] as const) tankRouter.post(`/sessions/:id/${action}`, ...(action === 'preview' ? [] : [managers]), requirePropertyAccess('body'), route(async (req, res) => {
  const data = z.object({ propertyId: id, version, ruleVersion: version.optional(), reason: z.string().trim().max(1000).optional() }).strict().parse(req.body);
  const result = await withPropertyPayrollTransaction(prisma, data.propertyId, async tx => {
    await activeProperty(tx, data.propertyId);
    const session = await tx.tankSession.findFirst({ where: { id: String(req.params.id), propertyId: data.propertyId } });
    if (!session) fail(404, 'Session not found.');
    const current = session!;
    if (current.version !== data.version) fail(409, 'This session changed. Refresh the register.');
    if (action !== 'preview' && await isMonthLocked(tx, data.propertyId, current.businessDate)) fail(423, 'This payroll month is locked.');
    if (action === 'void' || action === 'reopen') {
      if (!data.reason || data.reason.length < 3) fail(400, 'Enter a reason for the correction.');
      if (action === 'reopen' && current.status !== 'APPROVED' || action === 'void' && current.status === 'VOID') fail(409, 'This session cannot make that transition.');
      await tx.tankCommissionAllocation.deleteMany({ where: { sessionId: current.id } });
      const updated = await tx.tankSession.update({ where: { id: current.id }, data: { status: action === 'void' ? 'VOID' : 'DRAFT', snapshotJson: null, totalCents: null, unallocatedCents: null, approvedAt: null, approvedById: null, version: { increment: 1 } } });
      await audit(tx, req, data.propertyId, `TANK_SESSION_${action.toUpperCase()}`, current.id, { before: current, reason: data.reason });
      return { session: sessionView(updated) };
    }
    if (current.status !== 'DRAFT') {
      if (action === 'preview' && current.snapshotJson) return { preview: JSON.parse(current.snapshotJson) };
      fail(409, 'Only draft sessions can be approved.');
    }
    return calculateSession(tx, req, current, action, data.ruleVersion);
  });
  res.json(result);
}));
