import { tripsAvailable, tripsStartDate } from '../utils/tripsAvailability';
import { isBusinessDate } from '../utils/dates';
import { photoIds } from '../utils/photoCredits';
import { instructorIds } from '../utils/instructorCredits';
import { isExcludedFromCredit } from '../utils/staffEligibility';
import { prisma } from '../db';
import type { Prisma } from '@prisma/client';
import { isStoreAttendant, splitStorePool, STORE_ATTENDANT_RETAIL_RATE } from '../utils/storeAttendantPool';
import { addCents, productCents, splitCommissionCents } from '../utils/commissionMoney';
import { calculateIruveliDay, commissionFields, emptyCommissionCents, IRUVELI_CENTS_EFFECTIVE_DATE, type CommissionCents, type UnallocatedCommission } from './iruveliCommissionDay';

export interface StaffCommissionResult {
  staffId: string;
  staffName: string;
  roleTitle: string;
  courseCommission: number;
  diveCommission: number;
  overrideCommission: number;
  tipsCommission: number;
  personalCommission: number;
  totalCommission: number;
  tankCommission?: number;
  tripsWorked?: number;
  /** Present only when the period includes Iruveli's cent-based calculation. */
  cents?: CommissionCents;
}

export interface PersonalCommissionDetail {
  id: string;
  checkNumber: number;
  businessDate: string;
  guestName: string;
  roomNumber: string;
  itemName: string;
  role: string;
  staffId: string;
  staffName: string;
  amount: number;
  amountCents?: number;
}

export interface CommissionBreakdownDetail {
  id: string;
  billId: string;
  billItemId: string | null;
  checkNumber: number;
  businessDate: string;
  itemName: string;
  quantity: number | null;
  kind: 'COURSE_POOL' | 'DIVE_POOL' | 'OVERRIDE' | 'TIPS' | 'PERSONAL' | 'TANK';
  basisAmount: number;
  recipientCount: number;
  factor: number;
  unitRate?: number;
  explanation: string;
  amount: number;
  amountCents?: number;
  sourceBillItemIds?: string[];
}
type BreakdownSource = Pick<CommissionBreakdownDetail, 'billId' | 'billItemId' | 'checkNumber' | 'businessDate' | 'itemName' | 'quantity' | 'basisAmount'>;

export const commissionBillInclude = {
  items: { include: { item: true, instructorCredits: true, photoCredits: true } },
} satisfies Prisma.BillInclude;
export type CommissionBill = Prisma.BillGetPayload<{ include: typeof commissionBillInclude }>;

export const calculateCommissionForPeriod = async (
  propertyId: string,
  startDate: string,
  endDate: string,
  detailStaffId?: string,
  preloadedBills?: CommissionBill[]
) => {
  // Keep historical override amounts and apply Iru Veli's dive-only policy
  // only from the Trips & Tanks rollout, outside previously locked months.
  if (process.env.IRUVELI_COMMISSION_PROPERTY_ID === propertyId && (!isBusinessDate(IRUVELI_CENTS_EFFECTIVE_DATE) || IRUVELI_CENTS_EFFECTIVE_DATE < '2026-11-17')) throw new Error('Invalid Iruveli rollout date.');
  const iruveliCents = process.env.IRUVELI_COMMISSION_PROPERTY_ID === propertyId && endDate >= IRUVELI_CENTS_EFFECTIVE_DATE;
  // Locks finalized before rollout retain legacy results. Locking new payroll must
  // not switch it back to the old calculation.
  const locks = iruveliCents ? await prisma.monthLock.findMany({ where: { propertyId, isLocked: true, lockedAt: { lt: new Date(`${IRUVELI_CENTS_EFFECTIVE_DATE}T00:00:00+05:00`) }, yearMonth: { gte: startDate.slice(0, 7), lte: endDate.slice(0, 7) } }, select: { yearMonth: true } }) : [];
  const lockedMonths = new Set(locks.map(lock => lock.yearMonth));
  const usesCents = (date: string) => iruveliCents && date >= IRUVELI_CENTS_EFFECTIVE_DATE && !lockedMonths.has(date.slice(0, 7));
  const useNewOverride = iruveliCents && tripsAvailable(propertyId) && endDate >= tripsStartDate;
  const overrideLocks = useNewOverride ? await prisma.monthLock.findMany({ where: { propertyId, isLocked: true, lockedAt: { lt: new Date(`${tripsStartDate}T00:00:00+05:00`) }, yearMonth: { gte: startDate.slice(0, 7), lte: endDate.slice(0, 7) } }, select: { yearMonth: true } }) : [];
  const overrideLockedMonths = new Set(overrideLocks.map(lock => lock.yearMonth));
  const centAmounts = new Map<string, CommissionCents>();
  const unallocatedCommissions: UnallocatedCommission[] = [];
  let certificationCents = 0, retailCents = 0, unallocatedRetailCents = 0;
  let hasCentDates = false;

  // 1. Fetch active staff members for this property
  const staffMembers = await prisma.staffMember.findMany({
    where: { propertyId, isActive: true },
  });

  const staffMap = new Map(staffMembers.map((s) => [s.id, s]));

  // Initialize commission aggregates per staff
  const commissionMap = new Map<string, StaffCommissionResult>();
  for (const s of staffMembers) {
    commissionMap.set(s.id, {
      staffId: s.id,
      staffName: s.name,
      roleTitle: s.roleTitle,
      courseCommission: 0,
      diveCommission: 0,
      overrideCommission: 0,
      tipsCommission: 0,
      personalCommission: 0,
      totalCommission: 0,
    });
  }

  // 2. Fetch ACTIVE bills within the date range (rebated & deleted bills earn no commission)
  const bills = preloadedBills ?? await prisma.bill.findMany({
    where: {
      propertyId,
      status: 'ACTIVE',
      businessDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: commissionBillInclude,
  });

  // Group bills by businessDate for daily pool calculations
  const billsByDate = new Map<string, typeof bills>();
  for (const bill of bills) {
    const list = billsByDate.get(bill.businessDate) || [];
    list.push(bill);
    billsByDate.set(bill.businessDate, list);
  }

  // 3. Fetch attendance records within the date range
  const attendances = await prisma.attendance.findMany({
    where: {
      propertyId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      staffMember: true,
    },
  });

  const attendanceByDate = new Map<string, typeof attendances>();
  for (const att of attendances) {
    const list = attendanceByDate.get(att.date) || [];
    list.push(att);
    attendanceByDate.set(att.date, list);
  }

  const personalDetails: PersonalCommissionDetail[] = [];
  const breakdownDetails: CommissionBreakdownDetail[] = [];
  const addDetail = (staffId: string, source: BreakdownSource, kind: CommissionBreakdownDetail['kind'], explanation: string, recipientCount = 1, factor = 1, unitRate?: number, allocatedAmount?: number) => {
    if (staffId !== detailStaffId) return;
    breakdownDetails.push({ ...source, id: `${source.billItemId || source.billId}-${kind}-${breakdownDetails.length}`, kind,
      recipientCount, factor, unitRate, explanation, amount: allocatedAmount ?? source.basisAmount * factor / recipientCount });
  };
  // Certifications are tracked separately and never distributed as staff pay.
  let certificationPoolTotal = 0;
  let storeAttendantPoolTotal = 0;
  let unallocatedStoreAttendantPoolTotal = 0;

  // Helper function to check if attendance status counts toward commission pool
  // Per PDF Page 5: Present = Yes, Off / Off (half day) = Yes (counted in full).
  // Annual leave, Sick, Absent, Emergency = No.
  const isPresentForPool = (status?: string): boolean => {
    if (!status) return false;
    return ['PRESENT', 'OFF', 'OFF_HALF'].includes(status.toUpperCase());
  };

  // Base leader(s) for override (regardless of attendance)
  const baseLeaders = staffMembers.filter((s) => s.isBaseLeaderOverride);

  // 4. Process each day present in either bills or attendance (or between start and end)
  const allDates = new Set<string>([...billsByDate.keys(), ...attendanceByDate.keys()]);

  for (const date of allDates) {
    const dayBills = billsByDate.get(date) || [];
    const dayAttendance = attendanceByDate.get(date) || [];
    const dayAttendanceMap = new Map(dayAttendance.map((a) => [a.staffMemberId, a.status]));

    if (usesCents(date)) {
      hasCentDates = true;
      const diveOnlyOverride = useNewOverride && date >= tripsStartDate && !overrideLockedMonths.has(date.slice(0, 7));
      const day = calculateIruveliDay(propertyId, date, dayBills, staffMembers, dayAttendanceMap, diveOnlyOverride, detailStaffId);
      for (const [id, values] of day.amounts) {
        const row = centAmounts.get(id) ?? emptyCommissionCents();
        for (const field of commissionFields) row[field] = addCents(row[field], values[field]);
        centAmounts.set(id, row);
      }
      personalDetails.push(...day.personalDetails);
      breakdownDetails.push(...day.details);
      unallocatedCommissions.push(...day.unallocated);
      certificationCents = addCents(certificationCents, day.certificationCents);
      retailCents = addCents(retailCents, day.retailCents);
      unallocatedRetailCents = addCents(unallocatedRetailCents, day.unallocatedRetailCents);
      continue;
    }

    const canReceiveCredit = (id: string) => {
      const staff = staffMap.get(id);
      return Boolean(staff && staff.hireDate <= date && (!staff.leavingDate || staff.leavingDate >= date) && !isExcludedFromCredit(dayAttendanceMap.get(id)));
    };

    let dailyCoursePool = 0;
    let dailyDivePool = 0;
    const poolSources: (BreakdownSource & { poolType: 'COURSE_POOL' | 'DIVE_POOL' })[] = [];

    // Process bills for this day
    for (const bill of dayBills) {
      // Process Tips (Page 7: Split equally among the staff you picked on the bill)
      if (bill.tipAmount > 0 && bill.tipStaffIdsJson) {
        try {
          const tipStaffIds: string[] = [...new Set<string>(JSON.parse(bill.tipStaffIdsJson))].filter(canReceiveCredit);
          if (Array.isArray(tipStaffIds) && tipStaffIds.length > 0) {
            const tipShare = bill.tipAmount / tipStaffIds.length;
            for (const staffId of tipStaffIds) {
              const entry = commissionMap.get(staffId);
              if (entry) {
                entry.tipsCommission += tipShare;
                addDetail(staffId, { billId: bill.id, billItemId: null, checkNumber: bill.checkNumber, businessDate: date, itemName: 'Bill tip', quantity: null, basisAmount: bill.tipAmount }, 'TIPS', 'Bill tip divided among the eligible employees selected on the bill', tipStaffIds.length);
              }
            }
          }
        } catch (e) {
          console.error('Error parsing tipStaffIdsJson for bill', bill.id, e);
        }
      }

      // Process Line items: pools and personal commissions
      for (const line of bill.items) {
        // Ignore inconsistent historical cross-property item relations.
        if (line.item && line.item.propertyId !== propertyId) continue;
        // Pool contributions
        const ownedItem = line.item?.propertyId === propertyId ? line.item : null;
        const hasSnapshot = line.poolTypeSnapshot !== null && line.poolTypeSnapshot !== undefined &&
          typeof line.poolContributionAmount === 'number' && Number.isFinite(line.poolContributionAmount) && line.poolContributionAmount >= 0;
        const poolType = hasSnapshot ? line.poolTypeSnapshot : ownedItem?.poolType || 'NONE';
        // Null snapshots belong to legacy imports/records. Migration snapshots all
        // existing records before changing catalogue values; new bills save their own amount.
        const contribution = hasSnapshot ? line.poolContributionAmount! :
          ownedItem && Number.isFinite(ownedItem.poolContribution) && ownedItem.poolContribution >= 0 ? ownedItem.poolContribution * line.quantity : 0;

        if (poolType === 'COURSE_POOL') {
          dailyCoursePool += contribution;
        } else if (poolType === 'DIVE_POOL') {
          dailyDivePool += contribution;
        } else if (poolType === 'CERTIFICATION_POOL') {
          certificationPoolTotal += contribution;
        }

        const source = { billId: bill.id, billItemId: line.id, checkNumber: bill.checkNumber, businessDate: date, itemName: line.itemName, quantity: line.quantity };
        // Only explicit saved snapshots participate; never backfill historical sales.
        const retailPool = line.storeAttendantRateSnapshot === STORE_ATTENDANT_RETAIL_RATE &&
          typeof line.storeAttendantPoolAmount === 'number' && Number.isFinite(line.storeAttendantPoolAmount) && line.storeAttendantPoolAmount > 0 ? line.storeAttendantPoolAmount : 0;
        if (retailPool > 0) {
          storeAttendantPoolTotal += retailPool;
          const recipients = staffMembers.filter(staff => isStoreAttendant(staff.roleTitle) && canReceiveCredit(staff.id));
          const shares = splitStorePool(retailPool, recipients.map(staff => staff.id));
          if (!shares.length) unallocatedStoreAttendantPoolTotal += retailPool;
          for (const share of shares) {
            const entry = commissionMap.get(share.staffId)!;
            entry.personalCommission += share.amount;
            personalDetails.push({ id: `${line.id}-store-${share.staffId}`, checkNumber: bill.checkNumber, businessDate: date,
              guestName: bill.guestName, roomNumber: bill.roomNumber, itemName: line.itemName, role: 'Store attendant (Retail 5% shared)',
              staffId: share.staffId, staffName: entry.staffName, amount: share.amount });
            if (share.staffId === detailStaffId) breakdownDetails.push({ ...source, id: `${line.id}-STORE-${share.staffId}`, kind: 'PERSONAL',
              basisAmount: retailPool, recipientCount: shares.length, factor: 1, amount: share.amount,
              explanation: 'Saved 5% of Retail sales after discounts, before tax and service charge; shared equally among eligible Store attendants, with remaining cents allocated by staff ID.' });
          }
        }
        if (detailStaffId && contribution > 0 && (poolType === 'COURSE_POOL' || poolType === 'DIVE_POOL')) poolSources.push({ ...source, basisAmount: contribution, poolType });

        // Personal commission (fixed amounts to designated roles on line)
        if (line.personalCommissionsJson) {
          try {
            const rates = JSON.parse(line.personalCommissionsJson);
            const discountFactor = line.commissionDiscountFactor ?? 1;
            // Seller
            if (line.sellerStaffId && canReceiveCredit(line.sellerStaffId) && typeof rates.seller === 'number' && Number.isFinite(rates.seller) && rates.seller > 0) {
              const amt = Number(rates.seller) * line.quantity * discountFactor;
              const entry = commissionMap.get(line.sellerStaffId);
              if (entry) entry.personalCommission += amt;
              addDetail(line.sellerStaffId, { ...source, basisAmount: amt }, 'PERSONAL', 'Seller fixed payment per service unit × quantity × saved after-discount factor', 1, 1, Number(rates.seller));
              const sObj = staffMap.get(line.sellerStaffId);
              personalDetails.push({
                id: `${line.id}-seller`,
                checkNumber: bill.checkNumber,
                businessDate: bill.businessDate,
                guestName: bill.guestName,
                roomNumber: bill.roomNumber,
                itemName: line.itemName,
                role: 'Seller',
                staffId: line.sellerStaffId,
                staffName: sObj?.name || 'Staff',
                amount: amt,
              });
            }
            // Guide
            if (line.guideStaffId && canReceiveCredit(line.guideStaffId) && typeof rates.guide === 'number' && Number.isFinite(rates.guide) && rates.guide > 0) {
              const amt = Number(rates.guide) * line.quantity * discountFactor;
              const entry = commissionMap.get(line.guideStaffId);
              if (entry) entry.personalCommission += amt;
              addDetail(line.guideStaffId, { ...source, basisAmount: amt }, 'PERSONAL', 'Guide fixed payment per service unit × quantity × saved after-discount factor', 1, 1, Number(rates.guide));
              const sObj = staffMap.get(line.guideStaffId);
              personalDetails.push({
                id: `${line.id}-guide`,
                checkNumber: bill.checkNumber,
                businessDate: bill.businessDate,
                guestName: bill.guestName,
                roomNumber: bill.roomNumber,
                itemName: line.itemName,
                role: 'Guide',
                staffId: line.guideStaffId,
                staffName: sObj?.name || 'Staff',
                amount: amt,
              });
            }
            // The catalogue amount is paid in full to every selected instructor.
            if (typeof rates.instructor === 'number' && Number.isFinite(rates.instructor) && rates.instructor > 0) {
              for (const staffId of instructorIds(line)) {
                if (!canReceiveCredit(staffId)) continue;
                const amt = rates.instructor * line.quantity * discountFactor;
                const entry = commissionMap.get(staffId);
                if (entry) entry.personalCommission += amt;
                addDetail(staffId, { ...source, basisAmount: amt }, 'PERSONAL', 'Full saved catalogue instructor rate × quantity × saved after-discount factor; paid to each selected instructor', 1, 1, rates.instructor);
                personalDetails.push({ id: `${line.id}-instructor-${staffId}`, checkNumber: bill.checkNumber, businessDate: bill.businessDate,
                  guestName: bill.guestName, roomNumber: bill.roomNumber, itemName: line.itemName, role: 'Instructor',
                  staffId, staffName: staffMap.get(staffId)?.name || 'Staff', amount: amt });
              }
            }
            // Split one Photo commission pool across the selected staff.
            if (typeof rates.photo === 'number' && Number.isFinite(rates.photo) && rates.photo > 0) {
              const ids = photoIds(line);
              const poolCents = productCents(rates.photo, line.quantity, discountFactor);
              for (const { staffId, amountCents } of splitCommissionCents(poolCents, ids).shares) {
                if (!canReceiveCredit(staffId)) continue;
                const amt = amountCents / 100;
                const entry = commissionMap.get(staffId);
                if (entry) entry.personalCommission += amt;
                addDetail(staffId, { ...source, basisAmount: poolCents / 100 }, 'PERSONAL', 'Photo rate × quantity × saved after-discount factor; split equally among selected Photo staff, with remainder cents assigned by staff ID', ids.length, 1, rates.photo, amt);
                personalDetails.push({ id: `${line.id}-photo-${staffId}`, checkNumber: bill.checkNumber, businessDate: bill.businessDate,
                  guestName: bill.guestName, roomNumber: bill.roomNumber, itemName: line.itemName,
                  role: line.includesComplimentaryMedia ? 'Photo / Video' : 'Photo', staffId, staffName: staffMap.get(staffId)?.name || 'Staff', amount: amt });
              }
            }
            // Video
            if (line.videoStaffId && canReceiveCredit(line.videoStaffId) && typeof rates.video === 'number' && Number.isFinite(rates.video) && rates.video > 0) {
              const amt = Number(rates.video) * line.quantity * discountFactor;
              const entry = commissionMap.get(line.videoStaffId);
              if (entry) entry.personalCommission += amt;
              addDetail(line.videoStaffId, { ...source, basisAmount: amt }, 'PERSONAL', 'Video fixed payment per service unit × quantity × saved after-discount factor', 1, 1, Number(rates.video));
              const sObj = staffMap.get(line.videoStaffId);
              personalDetails.push({
                id: `${line.id}-video`,
                checkNumber: bill.checkNumber,
                businessDate: bill.businessDate,
                guestName: bill.guestName,
                roomNumber: bill.roomNumber,
                itemName: line.itemName,
                role: 'Video',
                staffId: line.videoStaffId,
                staffName: sObj?.name || 'Staff',
                amount: amt,
              });
            }
          } catch (e) {
            console.error('Error parsing personalCommissionsJson', line.id, e);
          }
        }
      }
    }

    // Determine who was employed and present on this day
    const courseSharingStaffToday = staffMembers.filter((s) => {
      if (!s.isDiveStaff || !s.isCoursePoolSharing) return false;
      if (s.hireDate > date) return false;
      if (s.leavingDate && s.leavingDate < date) return false;
      const status = dayAttendanceMap.get(s.id);
      return isPresentForPool(status);
    });

    const diveSharingStaffToday = staffMembers.filter((s) => {
      if (!s.isDiveStaff || !s.isDivePoolSharing) return false;
      if (s.hireDate > date) return false;
      if (s.leavingDate && s.leavingDate < date) return false;
      const status = dayAttendanceMap.get(s.id);
      return isPresentForPool(status);
    });

    // 1. Course Pool Distribution
    if (dailyCoursePool > 0 && courseSharingStaffToday.length > 0) {
      const share = dailyCoursePool / courseSharingStaffToday.length;
      for (const s of courseSharingStaffToday) {
        const entry = commissionMap.get(s.id);
        if (entry) entry.courseCommission += share;
        if (s.id === detailStaffId) for (const source of poolSources.filter(source => source.poolType === 'COURSE_POOL')) {
          addDetail(s.id, source, 'COURSE_POOL', 'Saved course pool contribution divided among eligible staff on this date', courseSharingStaffToday.length);
        }
      }
    }

    // 2. Dive Pool Distribution
    if (dailyDivePool > 0 && diveSharingStaffToday.length > 0) {
      const share = dailyDivePool / diveSharingStaffToday.length;
      for (const s of diveSharingStaffToday) {
        const entry = commissionMap.get(s.id);
        if (entry) entry.diveCommission += share;
        if (s.id === detailStaffId) for (const source of poolSources.filter(source => source.poolType === 'DIVE_POOL')) {
          addDetail(s.id, source, 'DIVE_POOL', 'Saved dive pool contribution divided among eligible staff on this date', diveSharingStaffToday.length);
        }
      }
    }

    // 3. Base-Leader Override (+10% of total pool, paid regardless of attendance)
    // Page 7: "An extra 10% of the pool, paid to the base leader(s) — regardless of attendance."
    const totalDayPool = dailyCoursePool + dailyDivePool;
    const employedBaseLeaders = baseLeaders.filter(bl => bl.hireDate <= date && (!bl.leavingDate || bl.leavingDate >= date) && dayAttendanceMap.get(bl.id)?.toUpperCase() !== 'BASIC');
    if (totalDayPool > 0 && employedBaseLeaders.length > 0) {
      const overrideTotal = totalDayPool * 0.10;
      const overrideShare = overrideTotal / employedBaseLeaders.length;
      for (const bl of employedBaseLeaders) {
        const entry = commissionMap.get(bl.id);
        if (entry) entry.overrideCommission += overrideShare;
        if (bl.id === detailStaffId) for (const source of poolSources) {
          addDetail(bl.id, source, 'OVERRIDE', 'Extra 10% of the saved pool contribution divided among employed base leaders', employedBaseLeaders.length, 0.10);
        }
      }
    }
  }

  // Calculate totals and round figures to 2 decimal places
  const staffResults: StaffCommissionResult[] = Array.from(commissionMap.values())
    .map((r) => {
      const total =
        r.courseCommission +
        r.diveCommission +
        r.overrideCommission +
        r.tipsCommission +
        r.personalCommission;
      const legacy = {
        ...r,
        courseCommission: Math.round(r.courseCommission * 100) / 100,
        diveCommission: Math.round(r.diveCommission * 100) / 100,
        overrideCommission: Math.round(r.overrideCommission * 100) / 100,
        tipsCommission: Math.round(r.tipsCommission * 100) / 100,
        personalCommission: Math.round(r.personalCommission * 100) / 100,
        totalCommission: Math.round(total * 100) / 100,
      };
      if (!hasCentDates) return legacy;
      const cents = emptyCommissionCents();
      const additions = centAmounts.get(r.staffId) ?? emptyCommissionCents();
      for (const field of commissionFields) cents[field] = addCents(productCents(legacy[field]), additions[field]);
      // Preserve legacy payroll totals, including their historical component rounding.
      cents.totalCommission = addCents(productCents(legacy.totalCommission), ...commissionFields.map(field => additions[field]));
      return { ...legacy, ...Object.fromEntries([...commissionFields, 'totalCommission' as const].map(field => [field, cents[field] / 100])), cents };
    })
    .sort((a, b) => b.totalCommission - a.totalCommission);

  let tankCents = 0;
  if (tripsAvailable(propertyId) && endDate >= tripsStartDate) {
    const allocations = await prisma.tankCommissionAllocation.findMany({
      where: { session: {
        propertyId,
        status: 'APPROVED',
        businessDate: { gte: startDate > tripsStartDate ? startDate : tripsStartDate, lte: endDate },
      } },
      include: { session: { select: { businessDate: true, boatName: true, activityType: true } } },
    });
    const byStaff = new Map<string, { cents: number; trips: number }>();
    const rows = new Map(staffResults.map(row => [row.staffId, row]));
    for (const allocation of allocations) {
      const amount = byStaff.get(allocation.staffId) ?? { cents: 0, trips: 0 };
      amount.cents = addCents(amount.cents, allocation.amountCents);
      amount.trips++;
      byStaff.set(allocation.staffId, amount);
      if (!rows.has(allocation.staffId)) {
        const row: StaffCommissionResult = {
          staffId: allocation.staffId, staffName: allocation.staffName, roleTitle: allocation.staffRoleTitle,
          courseCommission: 0, diveCommission: 0, overrideCommission: 0, tipsCommission: 0,
          personalCommission: 0, totalCommission: 0,
        };
        rows.set(row.staffId, row);
        staffResults.push(row);
      }
      if (allocation.staffId === detailStaffId) {
        const value = allocation.amountCents / 100;
        breakdownDetails.push({
          id: allocation.id, billId: '', billItemId: null, checkNumber: 0,
          businessDate: allocation.session.businessDate,
          itemName: allocation.session.boatName ?? allocation.session.activityType,
          quantity: null, kind: 'TANK', explanation: 'Saved trip commission for ' + allocation.role,
          basisAmount: value, recipientCount: 1, factor: 1, amount: value, amountCents: allocation.amountCents,
        });
      }
    }
    for (const [staffId, amount] of byStaff) {
      const row = rows.get(staffId)!;
      row.tankCommission = amount.cents / 100;
      row.tripsWorked = amount.trips;
      const total = addCents(row.cents?.totalCommission ?? productCents(row.totalCommission), amount.cents);
      row.totalCommission = total / 100;
      if (row.cents) row.cents.totalCommission = total;
      tankCents = addCents(tankCents, amount.cents);
    }
    if (allocations.length) staffResults.sort((a, b) => b.totalCommission - a.totalCommission);
  }

  const grandTotal = hasCentDates || tankCents > 0 ? addCents(...staffResults.map(row => row.cents?.totalCommission ?? productCents(row.totalCommission))) / 100 : staffResults.reduce((acc, curr) => acc + curr.totalCommission, 0);

  return {
    staffResults,
    personalDetails,
    breakdownDetails,
    certificationPoolTotal: hasCentDates ? addCents(productCents(Math.round(certificationPoolTotal * 100) / 100), certificationCents) / 100 : Math.round(certificationPoolTotal * 100) / 100,
    storeAttendantPoolTotal: hasCentDates ? addCents(productCents(Math.round(storeAttendantPoolTotal * 100) / 100), retailCents) / 100 : Math.round(storeAttendantPoolTotal * 100) / 100,
    unallocatedStoreAttendantPoolTotal: hasCentDates ? addCents(productCents(Math.round(unallocatedStoreAttendantPoolTotal * 100) / 100), unallocatedRetailCents) / 100 : Math.round(unallocatedStoreAttendantPoolTotal * 100) / 100,
    ...(hasCentDates ? { calculationVersion: 'IRUVELI_CENTS_V1' as const, unallocatedCommissions } : {}),
    grandTotal: hasCentDates || tankCents > 0 ? grandTotal : Math.round(grandTotal * 100) / 100,
  };
};
