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
    const property = await prisma.property.findUnique({ where: { id: parsed.data.propertyId }, select: { code: true, pmsPropertyCode: true, isActive: true } });
    if (!property?.isActive) return res.status(404).json({ error: 'Active property not found.' });
    const code = pmsPropertyCodeSchema.safeParse(property.pmsPropertyCode || property.code);
    if (!code.success) return res.status(409).json({ error: 'Set this property’s PMS resort code in Administration → Properties before looking up guests.' });
    const result = await lookupInhouseGuests(code.data, parsed.data.roomNumber);
    return res.json({ ...result, roomNumber: parsed.data.roomNumber, count: result.guests.length });
  } catch (error) {
    if (error instanceof PmsLookupError) return res.status(error.status).json({ error: error.message, requestId: error.requestId });
    console.error('PMS guest lookup failed.');
    return res.status(500).json({ error: 'Unable to look up guests. You can enter their details manually.' });
  }
});
