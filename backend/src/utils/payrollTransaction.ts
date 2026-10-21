import { Prisma, PrismaClient } from '@prisma/client';

// All bill mutations, attendance saves and payroll lock transitions share this lock.
// Property scope also serializes re-dates before their current date is read, so a
// concurrent re-date cannot make a later mutation check the wrong month.
export const withPropertyPayrollTransaction = <T>(client: PrismaClient, propertyId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
  client.$transaction(async tx => {
    // Return an integer, not PostgreSQL's void type, for Prisma deserialization.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['payroll', propertyId])}, 0))) AS payroll_lock`;
    return operation(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15000 });

export const payrollReply = (status: number, body: unknown) => ({ status, body });
