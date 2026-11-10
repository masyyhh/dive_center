import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { businessToday } from '../../utils/dates';
import { lookupInhouseGuests, pmsPropertyCodeSchema } from '../pmsService';
import { disclaimerTestGuestsEnabled, disclaimerTestGuests } from '../disclaimerTesting';
import { guestSelector } from './validation';
import { z } from 'zod';
export class RentalError extends Error { constructor(public status: number, message: string) { super(message); } }
export const fail = (message: string): never => { throw new RentalError(409, message); };
export async function lockProperty(tx: Prisma.TransactionClient, propertyId: string) {
  await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${propertyId} FOR UPDATE`;
  const property = await tx.property.findUnique({ where: { id: propertyId } });
  if (!property?.isActive || property.deletedAt) throw new RentalError(404, 'Active property not found.');
  return property;
}
export async function stockAvailability(tx: Pick<Prisma.TransactionClient, 'equipmentStock' | 'equipmentRentalLine'>, propertyId: string) {
  const stocks = await tx.equipmentStock.findMany({ where: { propertyId }, orderBy: [{ category: 'asc' }, { name: 'asc' }, { code: 'asc' }] });
  const held = await tx.equipmentRentalLine.findMany({ where: { stock: { propertyId }, rental: { status: { in: ['ACTIVE', 'PARTIALLY_RETURNED'] } } }, select: { stockId: true, quantity: true, returnedQuantity: true } });
  const assigned = new Map<string, number>();
  for (const line of held) assigned.set(line.stockId, (assigned.get(line.stockId) || 0) + line.quantity - line.returnedQuantity);
  return stocks.map(stock => ({ ...stock, assignedQuantity: assigned.get(stock.id) || 0, availableQuantity: stock.isActive && stock.condition !== 'DAMAGED' ? Math.max(0, stock.quantity - stock.damagedQuantity - (assigned.get(stock.id) || 0)) : 0 }));
}
export async function lookupRentalGuests(propertyId: string, roomNumber: string) {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property?.isActive || property.deletedAt) throw new RentalError(404, 'Active property not found.');
  if (disclaimerTestGuestsEnabled()) return disclaimerTestGuests(roomNumber);
  const codes = z.array(pmsPropertyCodeSchema).min(1).max(7).safeParse(property.pmsPropertyCodes.length ? property.pmsPropertyCodes : [property.pmsPropertyCode || property.code]);
  if (!codes.success) throw new RentalError(409, 'Configure PMS resorts in Administration → Properties before looking up guests.');
  return (await Promise.all([...new Set(codes.data)].map(code => lookupInhouseGuests(code, roomNumber)))).flatMap(r => r.guests);
}
export async function resolveGuest(propertyId: string, selector: z.infer<typeof guestSelector>) {
  if ('recordId' in selector) {
    const record = await prisma.waterSportsRecord.findFirst({ where: { id: selector.recordId, propertyId } });
    if (!record) throw new RentalError(404, 'Guest record not found for this property.');
    return { id: record.id, fullName: record.guestName, roomNumber: record.roomNumber, confirmationNumber: record.confirmationNumber, arrivalDate: null, checkoutDate: record.departureDate, propertyCode: record.pmsPropertyCode, guestType: 'main', nationality: null, nationalityCode: null };
  }
  const guests = await lookupRentalGuests(propertyId, selector.roomNumber);
  const guest = guests.find(g => g.fullName === selector.fullName && g.confirmationNumber === selector.confirmationNumber && g.propertyCode === selector.propertyCode);
  if (!guest) throw new RentalError(409, 'Guest details changed. Look up the room and select the guest again.');
  return { ...guest, id: `${guest.propertyCode}:${guest.confirmationNumber || ''}:${guest.fullName}` };
}
export const rentalInclude = { lines: { orderBy: { id: 'asc' as const } }, agreements: { orderBy: { createdAt: 'desc' as const }, include: { session: { select: { id: true, expiresAt: true, record: { select: { id: true, runningNumber: true, signedAt: true } } } } } }, history: { orderBy: { createdAt: 'desc' as const }, take: 100, include: { actor: { select: { name: true } } } } };
export async function event(tx: Prisma.TransactionClient, rentalId: string, propertyId: string, actorId: string, action: string, details: Prisma.InputJsonObject) {
  await tx.rentalEvent.create({ data: { rentalId, actorId, action, details } });
  await tx.auditLog.create({ data: { propertyId, userId: actorId, action: `EQUIPMENT_${action}`, targetType: 'EquipmentRental', targetId: rentalId, details: JSON.stringify(details) } });
}
export async function prepareLines(tx: Prisma.TransactionClient, propertyId: string, inputs: { stockId: string; quantity: number }[]) {
  const stocks = await stockAvailability(tx, propertyId);
  return inputs.map(input => {
    const stock = stocks.find(s => s.id === input.stockId);
    if (!stock || !stock.isActive || input.quantity > stock.availableQuantity) fail('Equipment is unavailable. Refresh inventory and adjust the quantity.');
    return { stockId: stock!.id, name: stock!.name, code: stock!.code, category: stock!.category, size: stock!.size, serialNumber: stock!.serialNumber, condition: stock!.condition, quantity: input.quantity, priceCents: stock!.priceCents };
  });
}
export const reference = () => `RENT-${businessToday().replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
export const defaultRentalTerms = `I acknowledge receipt of the equipment listed below in the stated condition and agree to return it by the expected return date. I will inspect the equipment before use, report defects promptly, use it only as instructed, and keep it secure. I accept responsibility for loss, theft, and damage during my rental, except pre-existing defects and normal wear. Any repair, replacement, or additional hire charges must be explained and documented by the dive centre. I will report any loss, theft, or damage immediately. A parent or guardian must sign for a guest under 18.`;
