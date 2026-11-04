import { photoIds } from '../utils/photoCredits';
import { instructorIds } from '../utils/instructorCredits';
import { applyCheckoutDiscount } from '../utils/checkoutDiscount';
import { validationIssues } from '../utils/validation';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { isExcludedFromCredit } from '../utils/staffEligibility';
import { withPropertyPayrollTransaction, payrollReply } from '../utils/payrollTransaction';
import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireRole, requirePropertyAccess } from '../middleware/rbac';
import { logAuditEvent } from '../services/auditService';
import { poolContributionAmount } from '../utils/poolRates';
import { isMonthLocked } from './bill.payroll';
import { createBillSchema } from './bill.validation';

export function registerBillSaveRoutes(billsRouter: Router) {
  const saveBill = async (req: Request, res: Response) => {
    const editingId = req.method === 'PUT' ? String(req.params.id) : null;
    try {
      const parseResult = createBillSchema.safeParse(req.body);
      if(!parseResult.success) {
        return res.status(400).json({ error: 'Validation failed', details: validationIssues(parseResult.error) });
      }

      const data = parseResult.data;
      if(editingId && (!data.expectedUpdatedAt || !data.editReason)) return res.status(400).json({ error: 'An edit reason and the bill version are required.' });
      const result = await withPropertyPayrollTransaction(prisma, data.propertyId, async prisma => {

        const previous = editingId ? await prisma.bill.findFirst({ where: { id: editingId, propertyId: data.propertyId }, include: { items: { orderBy: { linePosition: 'asc' }, include: { instructorCredits: true, photoCredits: true } } } }) : null;
        if(editingId && !previous) return payrollReply(404, { error: 'Bill not found in this property.' });
        if(previous) {
          if(previous.status !== 'ACTIVE') return payrollReply(409, { error: 'Only active posted bills can be edited.' });
          if(previous.updatedAt.toISOString() !== data.expectedUpdatedAt) return payrollReply(409, { error: 'This bill changed since you opened it. Reload the bill before editing.' });
          if(await isMonthLocked(prisma, previous.propertyId, previous.businessDate)) return payrollReply(423, { error: 'Cannot edit: Original month is locked for payroll.' });
        }
        // Check if month is locked
        if(await isMonthLocked(prisma, data.propertyId, data.businessDate)) {
          return payrollReply(423, {
            error: `Cannot create bill: The month (${data.businessDate.substring(0, 7)}) is locked for payroll.`,
          });
        }

        // PDF Page 3: "Numbers are unique to your centre: if you enter one a current bill already uses, the app stops the save and tells you."
        const existingCheck = await prisma.bill.findFirst({
          where: {
            propertyId: data.propertyId,
            ...(editingId ? { id: { not: editingId } } : {}),
            checkNumber: data.checkNumber,
            status: { in: ['ACTIVE', 'REBATED'] }, // Only active or rebated hold the check number; soft deleted release it
          },
        });

        if(existingCheck) {
          return payrollReply(400, {
            error: `Check number #${data.checkNumber} is already in use by another bill in this centre. Please change the check number before saving.`,
          });
        }

        const property = await prisma.property.findUnique({ where: { id: data.propertyId } });
        if(!property) return payrollReply(404, { error: 'Property not found.' });
        if(property.deletedAt) return payrollReply(410, { error: 'This property has been removed. Bill history is read-only.' });
        if(!property.isActive) return payrollReply(400, { error: 'Select an active property before creating a bill.' });

        const expectedPhotoPrice = property.autoPhotoPrice ?? 41.975;
        const expectedPhotoCommission = property.autoPhotoCommission ?? 4.5;
        const sourceFor = (line: typeof data.items[number]) => previous?.items.find(saved => saved.id === line.sourceLineId);
        for(const line of data.items) {
          if(line.photoStaffIds === undefined && sourceFor(line) && photoIds(sourceFor(line)!).length > 1) return payrollReply(400, { error: 'Refresh the bill editor to retain all Photo staff credits before saving.' });
          if(line.instructorStaffIds === undefined && sourceFor(line) && instructorIds(sourceFor(line)!).length > 1) return payrollReply(400, { error: 'Refresh the bill editor to retain all instructor credits before saving.' });
          if(line.sourceLineId && (!sourceFor(line) || (sourceFor(line)!.itemId || null) !== (line.itemId || null))) return payrollReply(400, { error: 'An edited line must refer to an original line from this bill and the same item.' });
        }
        const includedFor = (line: typeof data.items[number], item: { includesComplimentaryMedia: boolean }) => sourceFor(line)?.includesComplimentaryMedia ?? item.includesComplimentaryMedia;
        const photoPriceFor = (line: typeof data.items[number]) => sourceFor(line)?.unitPrice ?? expectedPhotoPrice;
        const photoCommissionFor = (line: typeof data.items[number]) => {
          const saved = sourceFor(line);
          if(saved) { try { return JSON.parse(saved.personalCommissionsJson || '{}').photo ?? 0; } catch { return 0; } }
          return expectedPhotoCommission;
        };

        const roots = data.items.filter(line => !line.autoPhotoFor);
        const providedIds = data.items.map(line => line.clientLineId).filter((id): id is string => Boolean(id));
        if(!roots.length || new Set(providedIds).size !== providedIds.length) return payrollReply(400, { error: 'Each activity must have a unique bill-line identifier.' });
        const itemIds = [...new Set(roots.map(line => line.itemId).filter((id): id is string => Boolean(id)))];
        const catalogue = await prisma.item.findMany({ where: { id: { in: itemIds }, propertyId: data.propertyId }, include: { category: true } });
        const itemMap = new Map(catalogue.filter(item => item.category.propertyId === data.propertyId).map(item => [item.id, item]));
        if(roots.some(line => !line.itemId || !itemMap.has(line.itemId) || (!itemMap.get(line.itemId)!.isActive && !sourceFor(line)))) return payrollReply(400, { error: 'Every activity must be an active catalogue item from this property.' });
        const rootMap = new Map(roots.filter(line => line.clientLineId).map(line => [line.clientLineId!, line]));
        const photoLines = new Map<string, typeof data.items[number]>();
        for(const photo of data.items.filter(line => line.autoPhotoFor)) {
          const parent = rootMap.get(photo.autoPhotoFor!);
          if(!parent || !includedFor(parent, itemMap.get(parent.itemId!)!) || photoLines.has(photo.autoPhotoFor!) || photo.itemId ||
            Math.abs(photo.unitPrice - photoPriceFor(photo)) > 0.001 || photo.quantity !== parent.quantity || photo.sellerStaffId || photo.guideStaffId || instructorIds(photo).length || photo.videoStaffId) {
            return payrollReply(400, { error: `Photo lines must be linked once to an included activity, priced at $${expectedPhotoPrice.toFixed(2)} per unit, with matching quantity and one photographer.` });
          }
          photoLines.set(photo.autoPhotoFor!, photo);
        }
        for(const parent of roots) {
          if(includedFor(parent, itemMap.get(parent.itemId!)!) && (!parent.clientLineId || !photoLines.has(parent.clientLineId) || photoIds(parent).length || parent.videoStaffId)) {
            return payrollReply(400, { error: `This activity includes an automatic $${expectedPhotoPrice.toFixed(2)} Photo line. Refresh the bill and select the team member on that Photo line before saving.` });
          }
        }
        // Use canonical Photo prices when calculating the bill-wide allocation.
        let checkout;
        try {
          checkout = applyCheckoutDiscount(data.items.map(line => line.autoPhotoFor ? { ...line, unitPrice: photoPriceFor(line) } : line), data.checkoutDiscountPercent);
        } catch(error) {
          return payrollReply(400, { error: error instanceof Error ? error.message : 'Invalid checkout discount.' });
        }
        const discountedRoots = checkout.lines.filter(line => !line.autoPhotoFor);
        const discountedPhotos = new Map(checkout.lines.filter(line => line.autoPhotoFor).map(line => [line.autoPhotoFor!, line]));
        const creditedIds = [...new Set([...data.tipStaffIds, ...data.items.flatMap(line => [line.sellerStaffId, line.guideStaffId, ...instructorIds(line), ...photoIds(line), line.videoStaffId].filter((id): id is string => Boolean(id)))])];
        const creditedStaff = await prisma.staffMember.findMany({ where: { id: { in: creditedIds }, propertyId: data.propertyId, isActive: true, hireDate: { lte: data.businessDate }, OR: [{ leavingDate: null }, { leavingDate: { gte: data.businessDate } }] }, select: { id: true } });
        if(creditedStaff.length !== creditedIds.length || new Set(data.tipStaffIds).size !== data.tipStaffIds.length) {
          return payrollReply(400, { error: 'Choose unique tip recipients and credited staff from this property.' });
        }

        const attendance = await prisma.attendance.findMany({ where: { propertyId: data.propertyId, date: data.businessDate, staffMemberId: { in: creditedIds } } });
        if(attendance.some(a => isExcludedFromCredit(a.status))) {
          return payrollReply(400, { error: 'Staff excluded by attendance on the business date cannot receive line commission or share tips. Remove them before saving.' });
        }

        // Mathematical calculations per PDF Page 3 & 4:
        // Gross -> - Discount -> + Service charge -> + Tax -> + Tip -> Net
        let grossAmount = 0;
        let totalDiscount = 0;

        const lineItemsData: Prisma.BillItemUncheckedCreateWithoutBillInput[] = [];
        for(const line of discountedRoots) {
          const item = itemMap.get(line.itemId!)!;
          const savedLine = sourceFor(line);
          const included = includedFor(line, item);
          let parsedRates: Record<string, unknown> = {};
          try { parsedRates = JSON.parse((savedLine ? savedLine.personalCommissionsJson : item.personalRatesJson) || '{}'); } catch { /* Invalid catalogue rates pay no commission. */ }
          const rates: Record<string, number> = {};
          for(const role of ['seller', 'guide', 'instructor', 'photo', 'video'] as const) {
            const amount = parsedRates && parsedRates[role];
            if(typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) rates[role] = amount;
          }
          if(included) {
            // Included photos are billed and credited once on the linked Photo line.
            delete rates.photo;
            delete rates.video;
          }
          const commissionDiscountFactor = 1 - line.discountPercent / 100;
          const totalPersonalCommission = Object.entries(rates).reduce((total, [role, rate]) => total + (role === 'instructor' ? instructorIds(line).length * rate * line.quantity : role === 'photo' ? photoIds(line).length * rate * line.quantity : (line as any)[`${role}StaffId`] ? rate * line.quantity : 0), 0) * commissionDiscountFactor;
          const lineGross = line.unitPrice * line.quantity;
          const discount = (lineGross * line.discountPercent) / 100;
          const lineTotal = lineGross - discount;

          grossAmount += lineGross;
          totalDiscount += discount;

          const parentId = randomUUID();
          lineItemsData.push({
            id: parentId,
            linePosition: lineItemsData.length,
            itemId: line.itemId || null,
            itemName: savedLine?.itemName ?? item.name,
            categoryName: savedLine?.categoryName ?? item.category.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            lineTotal,
            poolTypeSnapshot: savedLine?.poolTypeSnapshot ?? item.poolType,
            poolRateSnapshot: savedLine?.poolRateSnapshot ?? (savedLine && savedLine.poolContributionAmount != null
              ? ['COURSE_POOL', 'DIVE_POOL'].includes(savedLine.poolTypeSnapshot || '') && savedLine.lineTotal > 0 ? savedLine.poolContributionAmount / savedLine.lineTotal * 100
                : savedLine.poolTypeSnapshot === 'CERTIFICATION_POOL' ? savedLine.poolContributionAmount / savedLine.quantity : item.poolContribution
              : item.poolContribution),
            poolContributionAmount: 0,
            sellerStaffId: line.sellerStaffId || null,
            guideStaffId: line.guideStaffId || null,
            instructorStaffId: instructorIds(line)[0] || null,
            instructorCredits: { create: instructorIds(line).map(staffId => ({ staffId })) },
            commissionDiscountFactor,
            photoStaffId: included ? null : photoIds(line)[0] || null,
            photoCredits: { create: (included ? [] : photoIds(line)).map(staffId => ({ staffId })) },
            videoStaffId: included ? null : line.videoStaffId || null,
            includesComplimentaryMedia: included,
            personalCommissionsJson: JSON.stringify(rates),
            totalPersonalCommission,
          });
          const savedData = lineItemsData[lineItemsData.length - 1];
          savedData.poolContributionAmount = poolContributionAmount(savedData.poolTypeSnapshot!, savedData.poolRateSnapshot!, line.quantity, lineTotal);
          if(included) {
            const photo = discountedPhotos.get(line.clientLineId!)!;
            const photoGross = photoPriceFor(photo) * line.quantity;
            const photoDiscount = photoGross * photo.discountPercent / 100;
            grossAmount += photoGross;
            totalDiscount += photoDiscount;
            lineItemsData.push({
              id: randomUUID(), autoPhotoForLineId: parentId, linePosition: lineItemsData.length,
              itemId: null, itemName: 'Photo', categoryName: 'Photo & Video', quantity: line.quantity,
              unitPrice: photoPriceFor(photo), discountPercent: photo.discountPercent, lineTotal: photoGross - photoDiscount,
              poolTypeSnapshot: 'NONE', poolContributionAmount: 0,
              photoStaffId: photoIds(photo)[0] || null, photoCredits: { create: photoIds(photo).map(staffId => ({ staffId })) }, sellerStaffId: null, guideStaffId: null, instructorStaffId: null, videoStaffId: null,
              includesComplimentaryMedia: false, personalCommissionsJson: JSON.stringify({ photo: photoCommissionFor(photo) }),
              commissionDiscountFactor: 1 - photo.discountPercent / 100,
              totalPersonalCommission: photoIds(photo).length * photoCommissionFor(photo) * line.quantity * (1 - photo.discountPercent / 100),
            });
          }
        }

        const netBeforeCharges = grossAmount - totalDiscount;
        const oldBase = previous ? previous.grossAmount - previous.discountAmount : 0;
        const serviceChargeRate = previous?.serviceChargeRateSnapshot ?? (previous && oldBase > 0 ? previous.serviceChargeAmount / oldBase * 100 : property.serviceChargeRate);
        const taxRate = previous?.taxRateSnapshot ?? (previous && oldBase + previous.serviceChargeAmount > 0 ? previous.taxAmount / (oldBase + previous.serviceChargeAmount) * 100 : property.taxRate);
        const serviceChargeAmount = (netBeforeCharges * serviceChargeRate) / 100;
        const taxAmount = ((netBeforeCharges + serviceChargeAmount) * taxRate) / 100;
        const tipAmount = data.tipAmount || 0;
        const netAmount = netBeforeCharges + serviceChargeAmount + taxAmount + tipAmount;
        const amounts = [grossAmount, totalDiscount, serviceChargeAmount, taxAmount, tipAmount, netAmount,
          ...lineItemsData.flatMap(line => [line.lineTotal, line.poolContributionAmount, line.totalPersonalCommission])];
        if(amounts.some(amount => typeof amount !== 'number' || !Number.isFinite(amount * 100))) return payrollReply(400, { error: 'The bill total or commission is too large. Check prices and quantities.' });

        const billData = {
          propertyId: data.propertyId,
          checkNumber: data.checkNumber,
          businessDate: data.businessDate,
          guestName: data.guestName,
          roomNumber: data.roomNumber,
          departureDate: data.departureDate || null,
          nationality: data.nationality,
          grossAmount: Math.round(grossAmount * 100) / 100,
          discountAmount: Math.round(totalDiscount * 100) / 100,
          serviceChargeRateSnapshot: serviceChargeRate,
          taxRateSnapshot: taxRate,
          serviceChargeAmount: Math.round(serviceChargeAmount * 100) / 100,
          taxAmount: Math.round(taxAmount * 100) / 100,
          tipAmount: Math.round(tipAmount * 100) / 100,
          netAmount: Math.round(netAmount * 100) / 100,
          tipStaffIdsJson: data.tipStaffIds.length > 0 ? JSON.stringify(data.tipStaffIds) : null,
          status: 'ACTIVE' as const,
          notes: data.notes || null,
        };
        const bill = previous
          ? await prisma.bill.update({ where: { id: previous.id }, data: { ...billData, updatedAt: new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1)), items: { deleteMany: {}, create: lineItemsData } }, include: { items: { orderBy: { linePosition: 'asc' }, include: { instructorCredits: true, photoCredits: true } } } })
          : await prisma.bill.create({ data: { ...billData, createdById: req.user!.id, items: { create: lineItemsData } }, include: { items: { orderBy: { linePosition: 'asc' }, include: { instructorCredits: true, photoCredits: true } } } });

        // Update next check number on property if this check is higher
        if(data.checkNumber >= property.nextCheckNumber) {
          await prisma.property.update({
            where: { id: property.id },
            data: { nextCheckNumber: data.checkNumber + 1 },
          });
        }

        const auditDetails = {
          ...(previous ? { reason: data.editReason, before: previous, after: bill } : {}), checkNumber: bill.checkNumber, guest: bill.guestName, net: bill.netAmount,
          ...(data.checkoutDiscountPercent > 0 ? { checkoutDiscountPercent: data.checkoutDiscountPercent, checkoutDiscountAmount: checkout.amount } : {})
        };
        if(previous) {
          // A posted correction must never commit without its before/after audit record.
          await prisma.auditLog.create({
            data: {
              propertyId: bill.propertyId, userId: req.user!.id, action: 'BILL_EDIT', targetType: 'Bill', targetId: bill.id,
              details: JSON.stringify(auditDetails), ipAddress: req.ip || req.socket?.remoteAddress || '127.0.0.1'
            }
          });
        } else {
          await logAuditEvent({ client: prisma, req, propertyId: bill.propertyId, action: 'BILL_CREATE', targetType: 'Bill', targetId: bill.id, details: auditDetails });
        }

        return payrollReply(previous ? 200 : 201, { bill });
      });
      return res.status(result.status).json(result.body);
    } catch(error) {
      if((error as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'This check number is already in use by another live bill.' });
      console.error('Create bill error:', error);
      return res.status(500).json({ error: 'Failed to save bill.' });
    }
  };
  billsRouter.post('/', requireAuth, requirePropertyAccess('body', 'propertyId'), saveBill);
  billsRouter.put('/:id', requireAuth, requireRole('GLOBAL_ADMIN', 'PROPERTY_MANAGER'), requirePropertyAccess('body', 'propertyId'), saveBill);

}
