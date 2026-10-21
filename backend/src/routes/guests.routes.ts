import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess } from '../middleware/rbac';
import { pmsLookupLimiter } from '../middleware/security';
import { lookupInhouseGuests, PmsLookupError, pmsPropertyCodeSchema } from '../services/pmsService';

export const guestsRouter = Router();
// Resolve resort permissions and mappings on the server, never from a client-supplied PMS code.
guestsRouter.get('/inhouse', requireAuth, requirePropertyAccess('query', 'propertyId'), pmsLookupLimiter, async (req: Request, res: Response) => {
  res.setHeader?.('Cache-Control', 'no-store');
  const parsed = z.object({ propertyId: z.string().trim().min(1).max(100), roomNumber: z.string().trim().min(1).max(32).regex(/^[^\x00-\x1f\x7f]+$/) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid room number and select a property.' });
  try {
    const property = await prisma.property.findUnique({ where: { id: parsed.data.propertyId }, select: { code: true, pmsPropertyCode: true, pmsPropertyCodes: true, isActive: true } });
    if (!property?.isActive) return res.status(404).json({ error: 'Active property not found.' });
    const codes = z.array(pmsPropertyCodeSchema).min(1).max(7).safeParse(
      property.pmsPropertyCodes?.length ? property.pmsPropertyCodes : [property.pmsPropertyCode || property.code]
    );
    if (!codes.success) return res.status(409).json({ error: 'Set this property’s PMS resorts in Administration → Properties before looking up guests.' });
    // Return all assigned resort matches together so the user can choose the right guest.
    // Fail the lookup if any resort fails, avoiding a misleading partial or empty result.
    const results = await Promise.all([...new Set(codes.data)].map(code => lookupInhouseGuests(code, parsed.data.roomNumber)));
    const unique = new Map(results.flatMap(result => result.guests).map(guest => [JSON.stringify(guest), guest]));
    const guests = [...unique.values()];
    return res.json({ guests, roomNumber: parsed.data.roomNumber, count: guests.length, requestId: results.length === 1 ? results[0].requestId : undefined });
  } catch (error) {
    if (error instanceof PmsLookupError) return res.status(error.status).json({ error: error.message, requestId: error.requestId });
    console.error('PMS guest lookup failed.');
    return res.status(500).json({ error: 'Unable to look up guests. You can enter their details manually.' });
  }
});
