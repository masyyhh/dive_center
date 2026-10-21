import { isExcludedFromCredit } from '../utils/staffEligibility';
import { prisma } from '../db';

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
}

export const calculateCommissionForPeriod = async (
  propertyId: string,
  startDate: string,
  endDate: string
) => {
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
  const bills = await prisma.bill.findMany({
    where: {
      propertyId,
      status: 'ACTIVE',
      businessDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      items: {
        include: {
          item: true,
        },
      },
    },
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

    const canReceiveCredit = (id: string) => {
      const staff = staffMap.get(id);
      return Boolean(staff && staff.hireDate <= date && (!staff.leavingDate || staff.leavingDate >= date) && !isExcludedFromCredit(dayAttendanceMap.get(id)));
    };

    let dailyCoursePool = 0;
    let dailyDivePool = 0;

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
        const poolType = ownedItem?.poolType || 'NONE';
        const contribution = ownedItem && Number.isFinite(ownedItem.poolContribution) && ownedItem.poolContribution >= 0 ? ownedItem.poolContribution * line.quantity : 0;

        if (poolType === 'COURSE_POOL') {
          dailyCoursePool += contribution;
        } else if (poolType === 'DIVE_POOL') {
          dailyDivePool += contribution;
        }

        // Personal commission (fixed amounts to designated roles on line)
        if (line.personalCommissionsJson) {
          try {
            const rates = JSON.parse(line.personalCommissionsJson);
            // Seller
            if (line.sellerStaffId && canReceiveCredit(line.sellerStaffId) && typeof rates.seller === 'number' && Number.isFinite(rates.seller) && rates.seller > 0) {
              const amt = Number(rates.seller) * line.quantity;
              const entry = commissionMap.get(line.sellerStaffId);
              if (entry) entry.personalCommission += amt;
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
              const amt = Number(rates.guide) * line.quantity;
              const entry = commissionMap.get(line.guideStaffId);
              if (entry) entry.personalCommission += amt;
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
            // Instructor
            if (line.instructorStaffId && canReceiveCredit(line.instructorStaffId) && typeof rates.instructor === 'number' && Number.isFinite(rates.instructor) && rates.instructor > 0) {
              const amt = Number(rates.instructor) * line.quantity;
              const entry = commissionMap.get(line.instructorStaffId);
              if (entry) entry.personalCommission += amt;
              const sObj = staffMap.get(line.instructorStaffId);
              personalDetails.push({
                id: `${line.id}-instructor`,
                checkNumber: bill.checkNumber,
                businessDate: bill.businessDate,
                guestName: bill.guestName,
                roomNumber: bill.roomNumber,
                itemName: line.itemName,
                role: 'Instructor',
                staffId: line.instructorStaffId,
                staffName: sObj?.name || 'Staff',
                amount: amt,
              });
            }
            // Photo
            if (line.photoStaffId && canReceiveCredit(line.photoStaffId) && typeof rates.photo === 'number' && Number.isFinite(rates.photo) && rates.photo > 0) {
              const amt = Number(rates.photo) * line.quantity;
              const entry = commissionMap.get(line.photoStaffId);
              if (entry) entry.personalCommission += amt;
              const sObj = staffMap.get(line.photoStaffId);
              personalDetails.push({
                id: `${line.id}-photo`,
                checkNumber: bill.checkNumber,
                businessDate: bill.businessDate,
                guestName: bill.guestName,
                roomNumber: bill.roomNumber,
                itemName: line.itemName,
                role: 'Photo',
                staffId: line.photoStaffId,
                staffName: sObj?.name || 'Staff',
                amount: amt,
              });
            }
            // Video
            if (line.videoStaffId && canReceiveCredit(line.videoStaffId) && typeof rates.video === 'number' && Number.isFinite(rates.video) && rates.video > 0) {
              const amt = Number(rates.video) * line.quantity;
              const entry = commissionMap.get(line.videoStaffId);
              if (entry) entry.personalCommission += amt;
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
      }
    }

    // 2. Dive Pool Distribution
    if (dailyDivePool > 0 && diveSharingStaffToday.length > 0) {
      const share = dailyDivePool / diveSharingStaffToday.length;
      for (const s of diveSharingStaffToday) {
        const entry = commissionMap.get(s.id);
        if (entry) entry.diveCommission += share;
      }
    }

    // 3. Base-Leader Override (+10% of total pool, paid regardless of attendance)
    // Page 7: "An extra 10% of the pool, paid to the base leader(s) — regardless of attendance."
    const totalDayPool = dailyCoursePool + dailyDivePool;
    const employedBaseLeaders = baseLeaders.filter(bl => bl.hireDate <= date && (!bl.leavingDate || bl.leavingDate >= date));
    if (totalDayPool > 0 && employedBaseLeaders.length > 0) {
      const overrideTotal = totalDayPool * 0.10;
      const overrideShare = overrideTotal / employedBaseLeaders.length;
      for (const bl of employedBaseLeaders) {
        const entry = commissionMap.get(bl.id);
        if (entry) entry.overrideCommission += overrideShare;
      }
    }
  }

  // Calculate totals and round figures to 2 decimal places
  const staffResults = Array.from(commissionMap.values())
    .map((r) => {
      const total =
        r.courseCommission +
        r.diveCommission +
        r.overrideCommission +
        r.tipsCommission +
        r.personalCommission;
      return {
        ...r,
        courseCommission: Math.round(r.courseCommission * 100) / 100,
        diveCommission: Math.round(r.diveCommission * 100) / 100,
        overrideCommission: Math.round(r.overrideCommission * 100) / 100,
        tipsCommission: Math.round(r.tipsCommission * 100) / 100,
        personalCommission: Math.round(r.personalCommission * 100) / 100,
        totalCommission: Math.round(total * 100) / 100,
      };
    })
    .sort((a, b) => b.totalCommission - a.totalCommission);

  const grandTotal = staffResults.reduce((acc, curr) => acc + curr.totalCommission, 0);

  return {
    staffResults,
    personalDetails,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
};
