import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requirePropertyAccess } from '../middleware/rbac';
export const packagesRouter = Router();

// Retained read-only for billing existing packages.
// GET /api/packages?propertyId=...
packagesRouter.get('/', requireAuth, requirePropertyAccess('query', 'propertyId'), async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.query.propertyId);
    const includeInactive = req.query.includeInactive === 'true' && (req.user!.role === 'GLOBAL_ADMIN' || req.user!.assignedPropertyIds.includes(propertyId));

    const packages = await prisma.divePackage.findMany({
      where: {
        propertyId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        items: {
          include: {
            item: {
              include: {
                category: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return res.json({ packages: packages.map(pkg => ({ ...pkg, price: pkg.items.reduce((sum, row) => sum + row.item.price * row.quantity, 0) })) });
  } catch (error) {
    console.error('Fetch packages error:', error);
    return res.status(500).json({ error: 'Failed to fetch dive packages.' });
  }
});
