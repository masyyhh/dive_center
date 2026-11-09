import { prisma } from '../db';

// Helper to check if a month is locked for a property
export const isMonthLocked = async (client: Pick<typeof prisma, 'monthLock'>, propertyId: string, dateStr: string): Promise<boolean> => {
  const yearMonth = dateStr.substring(0, 7); // "YYYY-MM"
  const lock = await client.monthLock.findUnique({
    where: {
      propertyId_yearMonth: {
        propertyId,
        yearMonth,
      },
    },
  });
  return lock ? lock.isLocked : false;
};
