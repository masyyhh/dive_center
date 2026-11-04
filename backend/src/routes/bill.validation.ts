import { roomNumberSchema, positiveIntSchema, optionalDateSchema } from '../utils/fields';
import { boundedArray } from '../utils/validation';
import { z } from 'zod';
import { isBusinessDate } from '../utils/dates';

const billItemSchema = z.object({
  clientLineId: z.string().min(1).max(80).optional(),
  sourceLineId: z.string().min(1).max(100).optional(),
  autoPhotoFor: z.string().min(1).max(80).nullish(),
  itemId: z.string().optional().nullable(),
  itemName: z.string(),
  categoryName: z.string(),
  quantity: positiveIntSchema,
  unitPrice: z.number().min(0),
  discountPercent: z.number().min(0).max(100).default(0),
  sellerStaffId: z.string().optional().nullable(),
  guideStaffId: z.string().optional().nullable(),
  instructorStaffId: z.string().optional().nullable(),
  instructorStaffIds: boundedArray(z.string().min(1).max(100), 1000).refine(ids => new Set(ids).size === ids.length, 'Select each instructor only once.').optional(),
  photoStaffId: z.string().optional().nullable(),
  photoStaffIds: boundedArray(z.string().min(1).max(100), 1000).refine(ids => new Set(ids).size === ids.length, 'Select each Photo staff member only once.').optional(),
  videoStaffId: z.string().optional().nullable(),
  personalCommissionsJson: z.string().optional().nullable(),
  totalPersonalCommission: z.number().min(0).default(0),
});

export const createBillSchema = z.object({
  propertyId: z.string(),
  expectedUpdatedAt: z.iso.datetime().optional(),
  editReason: z.string().trim().min(5).max(1000).optional(),
  checkNumber: positiveIntSchema,
  businessDate: z.string().refine(isBusinessDate, 'Valid calendar date (YYYY-MM-DD) is required.'),
  guestName: z.string().trim().min(1, 'Guest name is required').max(300),
  roomNumber: roomNumberSchema,
  departureDate: optionalDateSchema,
  nationality: z.string().default('Other'),
  checkoutDiscountPercent: z.number().min(0).max(100).default(0),
  tipAmount: z.number().min(0).default(0),
  tipStaffIds: boundedArray(z.string(), 1000).optional().default([]),
  items: boundedArray(billItemSchema, 200).refine(items => items.length > 0, 'At least one item is required on a bill'),
  notes: z.string().optional().nullable(),
});

// POST /api/bills (Create new bill)
