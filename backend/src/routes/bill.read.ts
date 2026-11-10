import { roomNumberSchema } from '../utils/fields';
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess } from '../middleware/rbac';
import { businessToday } from '../utils/dates';
import { BillListError, listBills } from '../services/billList';

export function registerBillReadRoutes(billsRouter: Router) {
  // GET /api/bills/next-check?propertyId=...
  billsRouter.get('/next-check', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
    try {
      const propertyId = String(req.query.propertyId);
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if(!property) return res.status(404).json({ error: 'Property not found.' });

      // Find highest check number used by active or rebated bills
      const lastBill = await prisma.bill.findFirst({
        where: {
          propertyId,
          status: { in: ['ACTIVE', 'REBATED'] },
        },
        orderBy: { checkNumber: 'desc' },
        select: { checkNumber: true },
      });

      const nextNumber = Math.max(property.nextCheckNumber, lastBill ? lastBill.checkNumber + 1 : 0);
      return res.json({ nextCheckNumber: nextNumber });
    } catch(error) {
      console.error('Fetch next check error:', error);
      return res.status(500).json({ error: 'Failed to calculate next check number.' });
    }
  });

  // GET /api/bills/room-lookup?propertyId=...&roomNumber=...
  // PDF Page 4: "If a bill already exists for that room today, typing the room number offers to fill in the guest details from it."
  billsRouter.get('/room-lookup', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
    try {
      const { propertyId, roomNumber } = req.query;
      if(roomNumber === undefined || roomNumber === '') return res.json({ found: false });
      const parsedRoom = roomNumberSchema.safeParse(roomNumber);
      if(!parsedRoom.success) return res.status(400).json({ error: 'Enter a room number using 1–32 digits only.' });

      const today = businessToday();
      const match = await prisma.bill.findFirst({
        where: {
          propertyId: String(propertyId),
          roomNumber: parsedRoom.data,
          businessDate: today,
          status: 'ACTIVE',
        },
        orderBy: { createdAt: 'desc' },
        select: {
          guestName: true,
          roomNumber: true,
          departureDate: true,
          nationality: true,
          businessDate: true,
        },
      });

      if(match) {
        return res.json({ found: true, guest: match });
      }

      return res.json({ found: false });
    } catch(error) {
      console.error('Room lookup error:', error);
      return res.status(500).json({ error: 'Failed to lookup room.' });
    }
  });

  // GET /api/bills?propertyId=...&startDate=...&endDate=...&search=...
  billsRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
    try {
      return res.json(await listBills(req.query));
    } catch(error) {
      if (error instanceof BillListError) return res.status(400).json({ error: error.message });
      console.error('Fetch bills error:', error);
      return res.status(500).json({ error: 'Failed to fetch bills.' });
    }
  });

  // GET /api/bills/:id
  billsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const bill = await prisma.bill.findUnique({
        where: { id },
        include: {
          createdBy: { select: { id: true, name: true } },
          items: {
            orderBy: { linePosition: 'asc' },
            include: {
              sellerStaff: { select: { id: true, name: true, propertyId: true } },
              guideStaff: { select: { id: true, name: true, propertyId: true } },
              instructorCredits: { include: { staff: { select: { id: true, name: true, propertyId: true } } } },
              instructorStaff: { select: { id: true, name: true, propertyId: true } },
              photoCredits: { include: { staff: { select: { id: true, name: true, propertyId: true } } } },
              photoStaff: { select: { id: true, name: true, propertyId: true } },
              videoStaff: { select: { id: true, name: true, propertyId: true } },
            },
          },
        },
      });

      if(!bill) return res.status(404).json({ error: 'Bill not found.' });

      if(req.user!.role !== 'GLOBAL_ADMIN' && !req.user!.assignedPropertyIds.includes(bill.propertyId)) {
        return res.status(403).json({ error: 'Unauthorized to view this bill.' });
      }

      for(const line of bill.items) {
        if(line.photoCredits) line.photoCredits = line.photoCredits.filter(credit => credit.staff.propertyId === bill.propertyId);
        if(line.instructorCredits) line.instructorCredits = line.instructorCredits.filter(credit => credit.staff.propertyId === bill.propertyId);
        for(const role of ['sellerStaff', 'guideStaff', 'instructorStaff', 'photoStaff', 'videoStaff'] as const) {
          if(line[role] && line[role]!.propertyId !== bill.propertyId) line[role] = null;
        }
      }
      return res.json({ bill });
    } catch(error) {
      console.error('Get bill details error:', error);
      return res.status(500).json({ error: 'Failed to retrieve bill.' });
    }
  });

}
