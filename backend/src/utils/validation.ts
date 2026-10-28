import { z } from 'zod';
import type { RequestHandler } from 'express';

// Reject before per-element parsing: Zod 3's array .max() still visits every item.
export const boundedArray = <T extends z.ZodTypeAny>(element: T, maximum: number) =>
  z.preprocess((value, context) => {
    if (Array.isArray(value) && value.length > maximum) {
      context.addIssue({ code: 'custom', message: `Use at most ${maximum} entries.`, fatal: true });
      return z.NEVER;
    }
    return value;
  }, z.array(element).max(maximum));

export const validationIssues = (error: z.ZodError) => error.issues.slice(0, 20);

// Bound unknown/nested containers too, before any route's schema processes them.
// Large catalogue uploads are a single base64 string and retain their 5 MB envelope.
export const requestInputBudget: RequestHandler = (req, res, next) => {
  const pending: { value: unknown; depth: number }[] = [{ value: req.body, depth: 0 }];
  let remaining = 10000;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (--remaining < 0 || depth > 20) return res.status(400).json({ error: 'Request contains too many nested values.' });
    if (!value || typeof value !== 'object') continue;
    const keys = Object.keys(value);
    if (keys.length > 2000 || keys.length + pending.length > remaining) {
      return res.status(400).json({ error: 'Request contains too many entries.' });
    }
    for (const key of keys) pending.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
  }
  next();
};
