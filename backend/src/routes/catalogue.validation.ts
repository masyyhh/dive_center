import { z } from 'zod';
import { isPercentagePool, validPoolRate } from '../utils/poolRates';

const commissionRoles = ['seller', 'guide', 'instructor', 'photo', 'video'];
const validRates = (value: string) => {
  if(!value.trim()) return true;
  try {
    const rates = JSON.parse(value);
    return rates !== null && typeof rates === 'object' && !Array.isArray(rates) && Object.entries(rates).every(([role, amount]) => commissionRoles.includes(role) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0);
  } catch { return false; }
};
const activityFields = z.object({
  categoryId: z.string().trim().min(1),
  code: z.string().trim().max(50).optional(),
  name: z.string().trim().min(2).max(200),
  price: z.number().finite().nonnegative(),
  poolType: z.enum(['COURSE_POOL', 'CERTIFICATION_POOL', 'DIVE_POOL', 'NONE']).default('NONE'),
  poolContribution: z.number().finite().min(0).optional(),
  includesComplimentaryMedia: z.boolean().default(false),
  personalRoles: z.string().max(100).refine(value => value.split(',').every(role => !role.trim() || commissionRoles.includes(role.trim())), 'Choose supported commission roles.').optional().nullable(),
  personalRatesJson: z.string().max(2000).refine(validRates, 'Enter a JSON object with nonnegative amounts for supported commission roles.').optional().nullable(),
});
export const itemSchema = activityFields.extend({ propertyId: z.string().trim().min(1) }).strict()
  .transform(data => ({ ...data, poolContribution: data.poolContribution ?? (isPercentagePool(data.poolType) ? 10 : 0) }))
  .refine(data => validPoolRate(data.poolType, data.poolContribution), { path: ['poolContribution'], message: 'Course and dive pool rates must be between 0 and 100 percent.' });
export const itemUpdateSchema = activityFields.omit({ poolType: true, poolContribution: true, includesComplimentaryMedia: true }).partial().extend({ poolType: z.enum(['COURSE_POOL', 'CERTIFICATION_POOL', 'DIVE_POOL', 'NONE']).optional(), poolContribution: z.number().finite().min(0).optional(), includesComplimentaryMedia: z.boolean().optional(), isActive: z.boolean().optional() }).strict().refine(data => Object.keys(data).length > 0, 'Choose an activity field to update.');
