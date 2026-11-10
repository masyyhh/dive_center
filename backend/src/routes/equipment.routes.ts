import { Router, Request, Response, NextFunction } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess, requireRole } from '../middleware/rbac';
import { businessToday } from '../utils/dates';
import { id, stockSchema, rentalSchema, returnSchema, rentalStatus } from '../services/equipment/validation';
import { RentalError, fail, lockProperty, stockAvailability, resolveGuest, lookupRentalGuests, rentalInclude, event, prepareLines, reference, defaultRentalTerms } from '../services/equipment/service';
import { pmsLookupLimiter } from '../middleware/security';
import { PmsLookupError } from '../services/pmsService';

export const equipmentRouter = Router();
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(error => {
  if (error instanceof RentalError || error instanceof PmsLookupError) return res.status(error.status).json({ error: error.message });
  if (error?.code === 'P2002') return res.status(409).json({ error: 'That equipment ID or serial number already exists.' });
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || 'Check the form fields.' });
  next(error);
}); };
equipmentRouter.use(requireAuth);
equipmentRouter.use((_req, res, next) => { res.setHeader?.('Cache-Control', 'no-store'); next(); });
const read = requirePropertyAccess();
const write = requirePropertyAccess('body');
const manager = requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER');
const scope = (req: Request) => ({ id: String(req.params.id), propertyId: id.parse(req.body.propertyId) });
const serialize = <T extends { status: string; expectedReturnDate: string; lines: { quantity: number; priceCents: number }[] }>(r: T) => ({ ...r, displayStatus: rentalStatus(r, businessToday()), totalCents: r.lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0) });

equipmentRouter.get('/inventory', read, handle(async (req, res) => res.json(await stockAvailability(prisma, id.parse(req.query.propertyId)))));
equipmentRouter.post('/inventory', manager, write, handle(async (req, res) => {
  const data = stockSchema.parse(req.body);
  const stock = await prisma.$transaction(async tx => {
    await lockProperty(tx, data.propertyId);
    const stock = await tx.equipmentStock.create({ data: { ...data, serialNumber: data.serialNumber || null, damagedQuantity: data.condition === 'DAMAGED' ? data.quantity : 0 } });
    await tx.auditLog.create({ data: { propertyId: data.propertyId, userId: req.user!.id, action: 'EQUIPMENT_STOCK_CREATE', targetType: 'EquipmentStock', targetId: stock.id, details: JSON.stringify({ code: stock.code, quantity: stock.quantity }) } });
    return stock;
  });
  return res.status(201).json(stock);
}));
equipmentRouter.put('/inventory/:id', manager, write, handle(async (req, res) => {
  const data = stockSchema.parse(req.body);
  const stock = await prisma.$transaction(async tx => {
    await lockProperty(tx, data.propertyId);
    const old = await tx.equipmentStock.findFirst({ where: scope(req) });
    if (!old) throw new RentalError(404, 'Equipment not found.');
    const available = (await stockAvailability(tx, data.propertyId)).find(s => s.id === old.id)!;
    if (available.assignedQuantity > 0) fail('Return assigned equipment before editing this stock entry.');
    const stock = await tx.equipmentStock.update({ where: { id: old.id }, data: { ...data, serialNumber: data.serialNumber || null, damagedQuantity: data.condition === 'DAMAGED' ? data.quantity : 0 } });
    await tx.auditLog.create({ data: { propertyId: data.propertyId, userId: req.user!.id, action: 'EQUIPMENT_STOCK_UPDATE', targetType: 'EquipmentStock', targetId: old.id, details: JSON.stringify({ before: old, after: stock }) } });
    return stock;
  }); return res.json(stock);
}));
// Existing signed guests remain available when the PMS is offline; PMS lookup itself is reused at /guests/inhouse.
equipmentRouter.get('/guests/lookup', read, pmsLookupLimiter, handle(async (req, res) => {
  const propertyId = id.parse(req.query.propertyId);
  const room = z.string().regex(/^[0-9]{1,32}$/).parse(req.query.roomNumber);
  return res.json({ guests: await lookupRentalGuests(propertyId, room) });
}));
equipmentRouter.get('/guests', read, handle(async (req, res) => {
  const propertyId = id.parse(req.query.propertyId);
  const room = z.string().regex(/^[0-9]{1,32}$/).optional().parse(req.query.roomNumber);
  const records = await prisma.waterSportsRecord.findMany({ where: { propertyId, ...(room ? { roomNumber: room } : {}) }, orderBy: { signedAt: 'desc' }, take: 100, select: { id: true, guestName: true, roomNumber: true, confirmationNumber: true, departureDate: true, pmsPropertyCode: true } });
  return res.json(records);
}));
equipmentRouter.get('/rentals', read, handle(async (req, res) => {
  const propertyId = id.parse(req.query.propertyId);
  const cursor = z.string().max(100).optional().parse(req.query.cursor);
  const rows = await prisma.equipmentRental.findMany({ where: { propertyId }, include: rentalInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 31, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  return res.json({ rentals: rows.slice(0, 30).map(serialize), nextCursor: rows.length > 30 ? rows[29].id : null });
}));
equipmentRouter.get('/rentals/:id', read, handle(async (req, res) => {
  const rental = await prisma.equipmentRental.findFirst({ where: { id: String(req.params.id), propertyId: id.parse(req.query.propertyId) }, include: rentalInclude });
  if (!rental) throw new RentalError(404, 'Rental not found.');
  return res.json(serialize(rental));
}));
equipmentRouter.post('/rentals', write, handle(async (req, res) => {
  const data = rentalSchema.parse(req.body);
  if (data.expectedReturnDate < businessToday()) fail('Expected return cannot be before today.');
  const guest = await resolveGuest(data.propertyId, data.guest);
  const rental = await prisma.$transaction(async tx => {
    const property = await lockProperty(tx, data.propertyId);
    const staff = await tx.staffMember.findFirst({ where: { id: data.assignedStaffId, propertyId: data.propertyId, isActive: true, hireDate: { lte: businessToday() }, OR: [{ leavingDate: null }, { leavingDate: { gte: businessToday() } }] } });
    if (!staff) fail('Choose an active staff member from this property.');
    const lines = await prepareLines(tx, data.propertyId, data.lines);
    const rental = await tx.equipmentRental.create({ data: { propertyId: data.propertyId, reference: reference(), guestSnapshot: { ...guest, selector: data.guest }, expectedReturnDate: data.expectedReturnDate, assignedStaffId: staff!.id, assignedStaffName: staff!.name, currency: property.currency, createdById: req.user!.id, lines: { create: lines } }, include: rentalInclude });
    await event(tx, rental.id, data.propertyId, req.user!.id, 'DRAFT_CREATE', { reference: rental.reference });
    return rental;
  }); return res.status(201).json(serialize(rental));
}));
// Editing a draft invalidates all outstanding invitations; signed versions stay in history.
equipmentRouter.put('/rentals/:id', write, handle(async (req, res) => {
  const data = rentalSchema.safeExtend({ version: z.number().int().positive() }).parse(req.body);
  if (data.expectedReturnDate < businessToday()) fail('Expected return cannot be before today.');
  const guest = await resolveGuest(data.propertyId, data.guest);
  const rental = await prisma.$transaction(async tx => {
    await lockProperty(tx, data.propertyId);
    const old = await tx.equipmentRental.findFirst({ where: scope(req), include: { agreements: true } });
    if (!old) throw new RentalError(404, 'Rental not found.');
    if (old.status !== 'DRAFT' || old.version !== data.version) fail('Only the current draft can be edited. Refresh this rental.');
    const staff = await tx.staffMember.findFirst({ where: { id: data.assignedStaffId, propertyId: data.propertyId, isActive: true, hireDate: { lte: businessToday() }, OR: [{ leavingDate: null }, { leavingDate: { gte: businessToday() } }] } });
    if (!staff) fail('Choose an active staff member from this property.');
    const lines = await prepareLines(tx, data.propertyId, data.lines);
    await tx.waterSportsSession.updateMany({ where: { id: { in: old.agreements.map(a => a.sessionId) } }, data: { revokedAt: new Date() } });
    await tx.equipmentRentalLine.deleteMany({ where: { rentalId: old.id } });
    const updated = await tx.equipmentRental.update({ where: { id: old.id }, data: { guestSnapshot: { ...guest, selector: data.guest }, expectedReturnDate: data.expectedReturnDate, assignedStaffId: staff!.id, assignedStaffName: staff!.name, version: { increment: 1 }, lines: { create: lines } }, include: rentalInclude });
    await event(tx, old.id, data.propertyId, req.user!.id, 'DRAFT_UPDATE', { previousVersion: old.version, version: updated.version });
    return updated;
  }); return res.json(serialize(rental));
}));
// Signed lists are immutable. Additional equipment is a separate linked guest rental with its own signature.
equipmentRouter.post('/rentals/:id/agreement', write, handle(async (req, res) => {
  const data = z.object({ propertyId: id, version: z.number().int().positive() }).strict().parse(req.body);
  const token = randomBytes(32).toString('hex');
  const result = await prisma.$transaction(async tx => {
    await lockProperty(tx, data.propertyId);
    const rental = await tx.equipmentRental.findFirst({ where: scope(req), include: { lines: true } });
    if (!rental) throw new RentalError(404, 'Rental not found.');
    if (rental.status !== 'DRAFT' || rental.version !== data.version) fail('This rental changed. Refresh before preparing an agreement.');
    const existing = await tx.rentalAgreement.findMany({ where: { rentalId: rental.id, version: rental.version }, include: { session: { include: { record: true } } } });
    if (existing.some(a => a.session.record)) fail('This equipment list is already signed. Confirm the rental or close the draft.');
    await tx.waterSportsSession.updateMany({ where: { id: { in: existing.map(a => a.sessionId) } }, data: { revokedAt: new Date() } });
    const guest = rental.guestSnapshot as Record<string, string | null>;
    const published = await tx.waterSportsDocument.findMany({ where: { propertyId: data.propertyId, kind: 'EQUIPMENT_RENTAL' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], distinct: ['language'] });
    const documents = published.map(d => ({ id: d.id, language: d.language, languageName: d.languageName, title: d.title, body: d.body }));
    if (!documents.some(d => d.language === 'en')) documents.unshift({ id: randomUUID(), language: 'en', languageName: 'English', title: 'Equipment rental agreement', body: defaultRentalTerms });
    const total = rental.lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);
    const body = `Rental: ${rental.reference}\nGuest: ${guest.fullName}\nGuest ID: ${guest.id}\nRoom: ${guest.roomNumber}\nBooking: ${guest.confirmationNumber || '—'}\nArrival: ${guest.arrivalDate || '—'}\nDeparture: ${guest.checkoutDate || '—'}\nReturn by: ${rental.expectedReturnDate}\nAssigned by: ${rental.assignedStaffName}\n\n${rental.lines.map(l => `${l.quantity} × ${l.name} | ${l.category} | ${l.code}${l.serialNumber ? ` / ${l.serialNumber}` : ''} | ${l.size} | ${l.condition} | ${rental.currency} ${(l.priceCents / 100).toFixed(2)} each`).join('\n')}\n\nTotal rental: ${rental.currency} ${(total / 100).toFixed(2)}`;
    const session = await tx.waterSportsSession.create({ data: { propertyId: data.propertyId, formType: 'EQUIPMENT_RENTAL', roomNumber: guest.roomNumber!, staffFields: { returnDate: rental.expectedReturnDate, notes: rental.reference }, candidates: [{ ...guest, id: randomUUID() }], documents: documents.map(d => ({ ...d, body: `${d.body}\n\n${body}` })), tokenHash: createHash('sha256').update(token).digest('hex'), createdById: req.user!.id, expiresAt: new Date(Date.now() + 20 * 60 * 1000) } });
    await tx.rentalAgreement.create({ data: { rentalId: rental.id, version: rental.version, sessionId: session.id } });
    await event(tx, rental.id, data.propertyId, req.user!.id, 'AGREEMENT_PREPARE', { sessionId: session.id, version: rental.version });
    return { token, expiresAt: session.expiresAt };
  }); return res.status(201).json(result);
}));
equipmentRouter.post('/rentals/:id/confirm', write, handle(async (req, res) => {
  const data = z.object({ propertyId: id, version: z.number().int().positive() }).strict().parse(req.body);
  const rental = await prisma.$transaction(async tx => {
    await lockProperty(tx, data.propertyId);
    const rental = await tx.equipmentRental.findFirst({ where: scope(req), include: rentalInclude });
    if (!rental) throw new RentalError(404, 'Rental not found.');
    if (rental.status !== 'DRAFT' || rental.version !== data.version) fail('This rental changed. Refresh before confirming.');
    if (rental.expectedReturnDate < businessToday()) fail('The expected return date has passed. Close this draft and create a new rental.');
    if (!rental.agreements.some(a => a.version === rental.version && a.session.record)) fail('The guest must sign this rental agreement before equipment can be assigned.');
    const staff = await tx.staffMember.findFirst({ where: { id: rental.assignedStaffId, propertyId: data.propertyId, isActive: true, hireDate: { lte: businessToday() }, OR: [{ leavingDate: null }, { leavingDate: { gte: businessToday() } }] } });
    if (!staff) fail('Assigned staff is no longer active. Edit the draft and obtain a new signature.');
    const currentLines = await prepareLines(tx, data.propertyId, rental.lines);
    if (currentLines.some((line, i) => ['name', 'code', 'category', 'size', 'serialNumber', 'condition'].some(key => line[key as keyof typeof line] !== rental.lines[i][key as keyof typeof line]))) fail('Equipment details changed since this draft was prepared. Edit the draft and obtain a new signature.');
    const updated = await tx.equipmentRental.update({ where: { id: rental.id }, data: { status: 'ACTIVE', activatedAt: new Date(), version: { increment: 1 } }, include: rentalInclude });
    await event(tx, rental.id, data.propertyId, req.user!.id, 'ASSIGN', { reference: rental.reference, lines: rental.lines.map(l => ({ stockId: l.stockId, quantity: l.quantity })) });
    return updated;
  }); return res.json(serialize(rental));
}));
equipmentRouter.post('/rentals/:id/return', write, handle(async (req, res) => {
  const data = returnSchema.parse(req.body);
  const rental = await prisma.$transaction(async tx => {
    await lockProperty(tx, data.propertyId);
    const rental = await tx.equipmentRental.findFirst({ where: scope(req), include: { lines: true } });
    if (!rental) throw new RentalError(404, 'Rental not found.');
    if (!['ACTIVE', 'PARTIALLY_RETURNED'].includes(rental.status) || rental.version !== data.version) fail('This rental changed. Refresh before returning equipment.');
    for (const input of data.lines) {
      const line = rental.lines.find(l => l.id === input.lineId);
      if (!line || input.quantity > line.quantity - line.returnedQuantity) fail('Return quantity exceeds outstanding equipment.');
      await tx.equipmentRentalLine.update({ where: { id: line!.id }, data: { returnedQuantity: { increment: input.quantity } } });
      if (input.condition === 'DAMAGED') await tx.equipmentStock.update({ where: { id: line!.stockId }, data: { damagedQuantity: { increment: input.quantity }, ...(line!.serialNumber ? { condition: 'DAMAGED' } : {}) } });
      else {
        const stock = await tx.equipmentStock.findUniqueOrThrow({ where: { id: line!.stockId } });
        // A mixed bulk batch uses its least serviceable condition; damaged units stay quarantined separately.
        const rank = ['NEW', 'GOOD', 'FAIR'];
        const nextCondition = line!.serialNumber ? input.condition : rank[Math.max(rank.indexOf(stock.condition), rank.indexOf(input.condition))];
        await tx.equipmentStock.update({ where: { id: line!.stockId }, data: { condition: nextCondition } });
      }
    }
    const allReturned = rental.lines.every(line => line.returnedQuantity + (data.lines.find(l => l.lineId === line.id)?.quantity || 0) === line.quantity);
    const updated = await tx.equipmentRental.update({ where: { id: rental.id }, data: { status: allReturned ? 'RETURNED' : 'PARTIALLY_RETURNED', version: { increment: 1 } }, include: rentalInclude });
    await event(tx, rental.id, data.propertyId, req.user!.id, 'RETURN', { lines: data.lines, status: updated.status });
    return updated;
  }); return res.json(serialize(rental));
}));
equipmentRouter.post('/rentals/:id/close', write, handle(async (req, res) => {
  const data = z.object({ propertyId: id, version: z.number().int().positive() }).strict().parse(req.body);
  const rental = await prisma.$transaction(async tx => {
    await lockProperty(tx, data.propertyId);
    const old = await tx.equipmentRental.findFirst({ where: scope(req), include: { agreements: true } });
    if (!old) throw new RentalError(404, 'Rental not found.');
    if (!['DRAFT', 'RETURNED'].includes(old.status) || old.version !== data.version) fail('Return all equipment before closing this rental.');
    await tx.waterSportsSession.updateMany({ where: { id: { in: old.agreements.map(a => a.sessionId) } }, data: { revokedAt: new Date() } });
    const updated = await tx.equipmentRental.update({ where: { id: old.id }, data: { status: 'CLOSED', closedAt: new Date(), version: { increment: 1 } }, include: rentalInclude });
    await event(tx, old.id, data.propertyId, req.user!.id, 'CLOSE', { previousStatus: old.status });
    return updated;
  }); return res.json(serialize(rental));
}));
