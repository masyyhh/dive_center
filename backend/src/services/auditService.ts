import type { Prisma } from '@prisma/client';
import { Request } from 'express';
import { prisma } from '../db';

interface AuditParams {
  client?: Pick<Prisma.TransactionClient, 'auditLog'>;
  req?: Request;
  propertyId?: string | null;
  userId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, any>;
}

export const logAuditEvent = async ({
  client = prisma,
  req,
  propertyId,
  userId,
  action,
  targetType,
  targetId,
  details,
}: AuditParams) => {
  try {
    const effectiveUserId = userId || req?.user?.id || null;
    // Resource callers supply authorized context; account-wide events stay propertyless.
    const effectivePropertyId = propertyId ?? null;

    const ipAddress = req?.ip || req?.socket?.remoteAddress || '127.0.0.1';

    await client.auditLog.create({
      data: {
        propertyId: effectivePropertyId,
        userId: effectiveUserId,
        action,
        targetType,
        targetId: targetId ? String(targetId) : null,
        details: details ? JSON.stringify(details) : null,
        ipAddress,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
};
