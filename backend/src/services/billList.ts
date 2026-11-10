import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { businessToday, isBusinessDate } from '../utils/dates';

const date = z.string().refine(isBusinessDate);
const querySchema = z.object({
  propertyId: z.string().min(1).max(100),
  startDate: date.optional(), endDate: date.optional(),
  status: z.enum(['ALL', 'ACTIVE', 'REBATED', 'DELETED']).default('ALL'),
  search: z.string().trim().max(200).default(''),
  discountedOnly: z.enum(['true', 'false']).default('false'),
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(50),
  cursor: z.string().min(1).max(2048).optional(),
});
const cursorSchema = z.object({ version: z.literal(1), scope: z.string(), businessDate: date,
  checkNumber: z.number().int(), id: z.string().min(1).max(100) });
export class BillListError extends Error {}

export interface BillSummary {
  id: string; propertyId: string; checkNumber: number; businessDate: string;
  guestName: string; roomNumber: string; nationality: string;
  grossAmount: number; discountAmount: number; netAmount: number;
  status: string; createdAt: Date; updatedAt: Date;
}

/** A bounded keyset query, including numeric check-number substring search in PostgreSQL. */
export async function listBills(query: unknown) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) throw new BillListError('Choose valid dates, status, search, cursor and a limit from 1 to 100.');
  const q = parsed.data;
  if (!q.startDate && !q.endDate) {
    q.startDate = `${businessToday().slice(0, 7)}-01`;
    q.endDate = businessToday();
  }
  if (q.startDate && q.endDate && q.startDate > q.endDate) throw new BillListError('Choose startDate on or before endDate.');
  const scope = JSON.stringify([q.propertyId, q.startDate, q.endDate, q.status, q.search, q.discountedOnly]);
  const clauses = [Prisma.sql`"propertyId" = ${q.propertyId}`];
  if (q.startDate) clauses.push(Prisma.sql`"businessDate" >= ${q.startDate}`);
  if (q.endDate) clauses.push(Prisma.sql`"businessDate" <= ${q.endDate}`);
  if (q.status !== 'ALL') clauses.push(Prisma.sql`"status" = ${q.status}`);
  if (q.discountedOnly === 'true') clauses.push(Prisma.sql`"discountAmount" > 0`);
  if (q.search) {
    // Preserve literal substring semantics, including %, _ and backslash.
    const pattern = `%${q.search.replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push(Prisma.sql`("guestName" ILIKE ${pattern} OR "roomNumber" ILIKE ${pattern}
      OR "checkNumber"::text ILIKE ${pattern} OR "nationality" ILIKE ${pattern})`);
  }
  if (q.cursor) {
    let cursor: z.infer<typeof cursorSchema>;
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8'))); }
    catch { throw new BillListError('Invalid bill cursor. Start again from the first page.'); }
    if (cursor.scope !== scope) throw new BillListError('The filters changed. Start again from the first page.');
    clauses.push(Prisma.sql`("businessDate", "checkNumber", "id") < (${cursor.businessDate}, ${cursor.checkNumber}, ${cursor.id})`);
  }
  const rows = await prisma.$queryRaw<BillSummary[]>(Prisma.sql`
    SELECT "id", "propertyId", "checkNumber", "businessDate", "guestName", "roomNumber", "nationality",
      "grossAmount", "discountAmount", "netAmount", "status", "createdAt", "updatedAt"
    FROM "Bill" WHERE ${Prisma.join(clauses, ' AND ')}
    ORDER BY "businessDate" DESC, "checkNumber" DESC, "id" DESC LIMIT ${q.limit + 1}`);
  const hasMore = rows.length > q.limit;
  const bills = rows.slice(0, q.limit);
  const last = bills.at(-1);
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ version: 1, scope,
    businessDate: last.businessDate, checkNumber: last.checkNumber, id: last.id })).toString('base64url') : null;
  return { bills, nextCursor, hasMore, limit: q.limit };
}
