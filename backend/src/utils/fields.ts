import { z } from 'zod';
import { isBusinessDate } from './dates';

// Room identifiers stay strings so leading zeros survive forms, storage and PMS lookup.
export const roomNumberSchema = z.string().trim().regex(/^[0-9]{1,32}$/, 'Enter a room number using 1–32 digits only.');
export const positiveIntSchema = z.number().int().positive().max(2147483647, 'Enter a whole number no greater than 2147483647.');
export const optionalDateSchema = z.union([z.string().refine(isBusinessDate, 'Enter a valid calendar date.'), z.literal('')]).nullish();
