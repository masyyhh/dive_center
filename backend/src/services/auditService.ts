import { Request } from 'express';
import { prisma } from '../db';

interface AuditParams {
  req?: Request;
  propertyId?: string | null;
  userId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, any>;
}

export const logAuditEvent = async ({
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
    const effectivePropertyId =
      propertyId ||
      (req?.headers['x-property-id'] as string) ||
      (req?.query?.propertyId as string) ||
      (req?.body?.propertyId as string) ||
      null;

    const ipAddress =
      req?.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      req?.socket?.remoteAddress ||
      '127.0.0.1';

    await prisma.auditLog.create({
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
