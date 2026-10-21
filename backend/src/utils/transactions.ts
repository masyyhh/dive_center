import { Prisma, PrismaClient } from '@prisma/client';

// PostgreSQL can abort a serializable transaction when concurrent requests conflict.
// Retry the whole operation so a consumed OTP or failed-attempt counter is read again.
export const withSerializableTransaction = async <T>(client: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try { return await client.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 }); }
    catch (error) { if ((error as { code?: string })?.code !== 'P2034' || attempt >= 7) throw error; }
  }
};
