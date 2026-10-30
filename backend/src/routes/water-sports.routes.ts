import { Router, Request, Response, NextFunction } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';
import { lookupInhouseGuests, PmsLookupError, pmsPropertyCodeSchema, PmsGuest } from '../services/pmsService';
import { businessToday } from '../utils/dates';
import { documentKind, formTypeSchema, languageSchema, staffFieldsSchema, submissionSchema, defaultDisclaimerDocuments } from '../services/waterSportsForms';

export const waterSportsRouter = Router();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const roomSchema = z.string().trim().min(1).max(32).regex(/^[^\x00-\x1f\x7f]+$/);
const propertySchema = z.string().trim().min(1).max(100);
type Document = { id: string; language: string; languageName: string; title: string; body: string };
type Candidate = PmsGuest & { id: string };
const availableDocuments = async (propertyId: string, kind: string) => {
  const saved = await prisma.waterSportsDocument.findMany({ where: { propertyId, kind }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], distinct: ['language'] });
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  const vilu = property && [property.code, property.pmsPropertyCode, ...property.pmsPropertyCodes].includes('VILU');
  const documents = new Map((vilu ? defaultDisclaimerDocuments(kind) : []).map(d => [d.language, d]));
  for (const d of saved) documents.set(d.language, { id: d.id, language: d.language, languageName: d.languageName, title: d.title, body: d.body });
  return [...documents.values()];
};
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
waterSportsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

waterSportsRouter.get('/documents', requireAuth, requirePropertyAccess(), handle(async (req, res) => {
  const parsed = z.object({ propertyId: propertySchema, kind: z.enum(['PARTICIPATION', 'SNORKELING']) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a property and disclaimer.' });
  return res.json({ documents: await availableDocuments(parsed.data.propertyId, parsed.data.kind) });
}));
waterSportsRouter.post('/documents', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body'), handle(async (req, res) => {
  const parsed = z.object({ propertyId: propertySchema, kind: z.enum(['PARTICIPATION', 'SNORKELING']), language: languageSchema, languageName: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200), body: z.string().trim().min(100).max(30000) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a language code, language name, title and complete disclaimer text (100–30,000 characters).' });
  const document = await prisma.waterSportsDocument.create({ data: { ...parsed.data, createdById: req.user!.id } });
  await logAuditEvent({ req, propertyId: document.propertyId, action: 'WATER_SPORTS_DOCUMENT_PUBLISH', targetType: 'WaterSportsDocument', targetId: document.id, details: { language: document.language, kind: document.kind } });
  return res.status(201).json(document);
}));
waterSportsRouter.post('/sessions', requireAuth, requirePropertyAccess('body'), handle(async (req, res) => {
  const parsed = z.object({ propertyId: propertySchema, formType: formTypeSchema, roomNumber: roomSchema, staffFields: staffFieldsSchema }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the room number and staff fields.' });
  const { propertyId, formType, staffFields } = parsed.data;
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property?.isActive || property.deletedAt) return res.status(409).json({ error: 'Choose an active property.' });
  if ((formType === 'GEAR_RENTAL' || formType === 'AID_GEAR') && (!staffFields.maskNumber || !staffFields.finsNumber)) return res.status(400).json({ error: 'Enter the mask and fins numbers before handing over the tablet.' });
  if (formType === 'GEAR_RENTAL' && (!staffFields.rentalDuration || !staffFields.returnDate || staffFields.returnDate < businessToday())) return res.status(400).json({ error: 'Enter a rental duration and a return date on or after today.' });
  const documents = await availableDocuments(propertyId, documentKind(formType));
  if (!documents.length) return res.status(409).json({ error: 'A manager must publish the disclaimer for this property first.' });
  const token = randomBytes(32).toString('hex');
  const session = await prisma.waterSportsSession.create({ data: { ...parsed.data, documents, tokenHash: hash(token), createdById: req.user!.id, expiresAt: new Date(Date.now() + 20 * 60 * 1000) } });
  await logAuditEvent({ req, propertyId, action: 'WATER_SPORTS_SESSION_CREATE', targetType: 'WaterSportsSession', targetId: session.id });
  return res.status(201).json({ id: session.id, token, expiresAt: session.expiresAt });
}));
waterSportsRouter.post('/sessions/:id/revoke', requireAuth, requirePropertyAccess('body'), handle(async (req, res) => {
  const propertyId = propertySchema.safeParse(req.body.propertyId);
  if (!propertyId.success) return res.status(400).json({ error: 'Property is required.' });
  await prisma.waterSportsSession.updateMany({ where: { id: String(req.params.id), propertyId: propertyId.data }, data: { revokedAt: new Date() } });
  return res.json({ success: true });
}));
waterSportsRouter.get('/records', requireAuth, requirePropertyAccess(), handle(async (req, res) => {
  const parsed = z.object({ propertyId: propertySchema, before: z.coerce.number().int().positive().optional(), roomNumber: roomSchema.optional() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid record filter.' });
  const { propertyId, before, roomNumber } = parsed.data;
  const records = await prisma.waterSportsRecord.findMany({ where: { propertyId, ...(roomNumber ? { roomNumber } : {}), ...(before ? { runningNumber: { lt: before } } : {}) }, orderBy: { runningNumber: 'desc' }, take: 50, select: { id: true, runningNumber: true, formType: true, businessDate: true, guestName: true, roomNumber: true, departureDate: true, isMinor: true, signedAt: true } });
  return res.json({ records, nextBefore: records.length === 50 ? records[49].runningNumber : null });
}));
waterSportsRouter.get('/records/:id', requireAuth, requirePropertyAccess(), handle(async (req, res) => {
  const propertyId = propertySchema.safeParse(req.query.propertyId);
  if (!propertyId.success) return res.status(400).json({ error: 'Property is required.' });
  const record = await prisma.waterSportsRecord.findFirst({ where: { id: String(req.params.id), propertyId: propertyId.data } });
  if (!record) return res.status(404).json({ error: 'Record not found.' });
  return res.json(record);
}));

// A tablet capability has no staff permissions and only covers one prepared room and form.
const tabletLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Please wait a minute and try again.' } });
waterSportsRouter.use('/tablet', tabletLimiter);
const tabletSession = async (req: Request) => {
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  const session = await prisma.waterSportsSession.findUnique({ where: { tokenHash: hash(token) }, include: { record: { select: { runningNumber: true } } } });
  if (!session || session.expiresAt <= new Date() || (session.revokedAt && !session.record)) return null;
  const property = await prisma.property.findUnique({ where: { id: session.propertyId } });
  if (!property?.isActive || property.deletedAt) return null;
  return { session, property };
};
const expired = (res: Response) => res.status(410).json({ error: 'This tablet link has expired or was cancelled. Please ask a staff member for a new link.' });
waterSportsRouter.get('/tablet', handle(async (req, res) => {
  const context = await tabletSession(req);
  if (!context) return expired(res);
  const { session, property } = context;
  if (session.record) return res.json({ completed: true, runningNumber: session.record.runningNumber });
  return res.json({ propertyName: property.name, formType: session.formType, staffFields: session.staffFields, documents: session.documents, businessDate: businessToday(), expiresAt: session.expiresAt });
}));
waterSportsRouter.post('/tablet/guests', handle(async (req, res) => {
  const context = await tabletSession(req);
  if (!context) return expired(res);
  const { session, property } = context;
  if (session.record) return res.status(409).json({ error: 'This form has already been signed.' });
  const room = roomSchema.safeParse(req.body.roomNumber);
  if (!room.success || room.data !== session.roomNumber) return res.status(400).json({ error: 'Please enter the room number for this form, or ask a staff member for help.' });
  const claimed = await prisma.waterSportsSession.updateMany({ where: { id: session.id, lookupCount: { lt: 10 }, revokedAt: null, expiresAt: { gt: new Date() } }, data: { lookupCount: { increment: 1 } } });
  if (!claimed.count) return res.status(429).json({ error: 'Lookup limit reached. Please ask staff for a new form.' });
  const codes = z.array(pmsPropertyCodeSchema).min(1).max(7).safeParse(property.pmsPropertyCodes.length ? property.pmsPropertyCodes : [property.pmsPropertyCode || property.code]);
  if (!codes.success) return res.status(409).json({ error: 'Staff need to configure the PMS resorts for this property.' });
  try {
    const results = await Promise.all([...new Set(codes.data)].map(code => lookupInhouseGuests(code, room.data)));
    const unique = new Map(results.flatMap(r => r.guests).map(g => [JSON.stringify(g), g]));
    const candidates: Candidate[] = [...unique.values()].map(g => ({ ...g, id: randomUUID() }));
    const updated = await prisma.waterSportsSession.updateMany({ where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { candidates } });
    if (!updated.count) return expired(res);
    return res.json({ guests: candidates.map(g => ({ id: g.id, fullName: g.fullName, roomNumber: g.roomNumber, checkoutDate: g.checkoutDate, propertyCode: g.propertyCode })) });
  } catch (error) {
    if (error instanceof PmsLookupError) return res.status(error.status).json({ error: error.message, requestId: error.requestId });
    throw error;
  }
}));
waterSportsRouter.post('/tablet/sign', handle(async (req, res) => {
  const context = await tabletSession(req);
  if (!context) return expired(res);
  const { session } = context;
  if (session.record) return res.json({ completed: true, runningNumber: session.record.runningNumber });
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Select your name, acknowledge the disclaimer and sign.' });
  const data = parsed.data;
  const guest = (session.candidates as unknown as Candidate[]).find(g => g.id === data.candidateId);
  const document = (session.documents as unknown as Document[]).find(d => d.id === data.documentId);
  if (!guest || !document) return res.status(400).json({ error: 'Select your name and read an available disclaimer before signing.' });
  const record = await prisma.$transaction(async tx => {
    // Row claim serializes simultaneous submits. The unique sessionId also prevents duplicate records.
    const claim = await tx.waterSportsSession.updateMany({ where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() }, candidates: { equals: session.candidates! } }, data: { revokedAt: new Date() } });
    if (!claim.count) return tx.waterSportsRecord.findUnique({ where: { sessionId: session.id } });
    const record = await tx.waterSportsRecord.create({ data: {
      sessionId: session.id, propertyId: session.propertyId, formType: session.formType, businessDate: businessToday(),
      guestName: guest.fullName, roomNumber: guest.roomNumber, departureDate: guest.checkoutDate, confirmationNumber: guest.confirmationNumber, pmsPropertyCode: guest.propertyCode,
      staffFields: session.staffFields!, documentSnapshot: document, documentHash: hash(JSON.stringify(document)),
      isMinor: data.isMinor, guardianName: data.isMinor ? data.guardianName : null, signature: data.signature,
      createdById: session.createdById,
    } });
    await tx.auditLog.create({ data: { propertyId: session.propertyId, userId: session.createdById, action: 'WATER_SPORTS_SIGN', targetType: 'WaterSportsRecord', targetId: record.id, details: JSON.stringify({ runningNumber: record.runningNumber, documentId: document.id, language: document.language, guardian: data.isMinor }) } });
    // Do not retain the room's other guests after completion.
    await tx.waterSportsSession.update({ where: { id: session.id }, data: { candidates: [] } });
    return record;
  });
  if (!record) return res.status(409).json({ error: 'This form changed or expired. Reload the form and try again.' });
  return res.json({ completed: true, runningNumber: record.runningNumber });
}));
