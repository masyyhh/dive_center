import { z } from 'zod';
import { isBusinessDate } from '../../utils/dates';
import { roomNumberSchema } from '../../utils/fields';
import { boundedArray } from '../../utils/validation';
export const id = z.string().trim().min(1).max(100);
export const date = z.string().refine(isBusinessDate, 'Enter a valid calendar date.');
export const condition = z.enum(['NEW', 'GOOD', 'FAIR', 'DAMAGED']);
export const stockSchema = z.object({
  propertyId: id, code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100), size: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL']),
  serialNumber: z.string().trim().max(100).nullable().default(null), condition,
  quantity: z.number().int().min(1).max(10000), priceCents: z.number().int().min(0).max(10000000),
  isActive: z.boolean().default(true),
}).strict().superRefine((v, ctx) => {
  if (v.serialNumber && v.quantity !== 1) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Serialised equipment must have a quantity of one.' });
});
export const guestSelector = z.union([
  z.object({ recordId: id }).strict(),
  z.object({ roomNumber: roomNumberSchema, fullName: z.string().trim().min(1).max(300), confirmationNumber: z.string().max(100).nullable(), propertyCode: z.string().max(20) }).strict(),
]);
export const rentalSchema = z.object({
  propertyId: id, guest: guestSelector, expectedReturnDate: date, assignedStaffId: id,
  lines: boundedArray(z.object({ stockId: id, quantity: z.number().int().min(1).max(10000) }).strict(), 50).refine(v => v.length > 0, 'Add at least one item.'),
}).strict().refine(v => new Set(v.lines.map(l => l.stockId)).size === v.lines.length, 'Add each equipment entry once; adjust its quantity.');
export const returnSchema = z.object({ propertyId: id, version: z.number().int().positive(), lines: boundedArray(z.object({ lineId: id, quantity: z.number().int().positive().max(10000), condition, note: z.string().trim().max(1000).default('') }).strict(), 50).refine(v => v.length > 0, 'Add at least one item.') }).strict()
  .refine(v => new Set(v.lines.map(l => l.lineId)).size === v.lines.length, 'Return each line once.');
export function rentalStatus(rental: { status: string; expectedReturnDate: string }, today: string) {
  return ['ACTIVE', 'PARTIALLY_RETURNED'].includes(rental.status) && rental.expectedReturnDate < today ? 'OVERDUE' : rental.status;
}
