"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateCommissionForPeriod = exports.commissionBillInclude = void 0;
const dates_1 = require("../utils/dates");
const photoCredits_1 = require("../utils/photoCredits");
const instructorCredits_1 = require("../utils/instructorCredits");
const staffEligibility_1 = require("../utils/staffEligibility");
const db_1 = require("../db");
const storeAttendantPool_1 = require("../utils/storeAttendantPool");
const commissionMoney_1 = require("../utils/commissionMoney");
const iruveliCommissionDay_1 = require("./iruveliCommissionDay");
exports.commissionBillInclude = {
    items: { include: { item: true, instructorCredits: true, photoCredits: true } },
};
const calculateCommissionForPeriod = async (propertyId, startDate, endDate, detailStaffId, preloadedBills) => {
    // Explicit property ID scopes the schema-free backport. Preserve production's
    // existing 10% override on course + dive pools; this release changes rounding only.
    const diveOnlyOverride = false;
    if (process.env.IRUVELI_COMMISSION_PROPERTY_ID === propertyId && (!(0, dates_1.isBusinessDate)(iruveliCommissionDay_1.IRUVELI_CENTS_EFFECTIVE_DATE) || iruveliCommissionDay_1.IRUVELI_CENTS_EFFECTIVE_DATE < '2026-11-17'))
        throw new Error('Invalid Iruveli rollout date.');
    const iruveliCents = process.env.IRUVELI_COMMISSION_PROPERTY_ID === propertyId && endDate >= iruveliCommissionDay_1.IRUVELI_CENTS_EFFECTIVE_DATE;
    // Locks finalized before rollout retain legacy results. Locking new payroll must
    // not switch it back to the old calculation.
    const locks = iruveliCents ? await db_1.prisma.monthLock.findMany({ where: { propertyId, isLocked: true, lockedAt: { lt: new Date(`${iruveliCommissionDay_1.IRUVELI_CENTS_EFFECTIVE_DATE}T00:00:00+05:00`) }, yearMonth: { gte: startDate.slice(0, 7), lte: endDate.slice(0, 7) } }, select: { yearMonth: true } }) : [];
    const lockedMonths = new Set(locks.map(lock => lock.yearMonth));
    const usesCents = (date) => iruveliCents && date >= iruveliCommissionDay_1.IRUVELI_CENTS_EFFECTIVE_DATE && !lockedMonths.has(date.slice(0, 7));
    const centAmounts = new Map();
    const unallocatedCommissions = [];
    let certificationCents = 0, retailCents = 0, unallocatedRetailCents = 0;
    let hasCentDates = false;
    // 1. Fetch active staff members for this property
    const staffMembers = await db_1.prisma.staffMember.findMany({
        where: { propertyId, isActive: true },
    });
    const staffMap = new Map(staffMembers.map((s) => [s.id, s]));
    // Initialize commission aggregates per staff
    const commissionMap = new Map();
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
    const bills = preloadedBills ?? await db_1.prisma.bill.findMany({
        where: {
            propertyId,
            status: 'ACTIVE',
            businessDate: {
                gte: startDate,
                lte: endDate,
            },
        },
        include: exports.commissionBillInclude,
    });
    // Group bills by businessDate for daily pool calculations
    const billsByDate = new Map();
    for (const bill of bills) {
        const list = billsByDate.get(bill.businessDate) || [];
        list.push(bill);
        billsByDate.set(bill.businessDate, list);
    }
    // 3. Fetch attendance records within the date range
    const attendances = await db_1.prisma.attendance.findMany({
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
    const attendanceByDate = new Map();
    for (const att of attendances) {
        const list = attendanceByDate.get(att.date) || [];
        list.push(att);
        attendanceByDate.set(att.date, list);
    }
    const personalDetails = [];
    const breakdownDetails = [];
    const addDetail = (staffId, source, kind, explanation, recipientCount = 1, factor = 1, unitRate) => {
        if (staffId !== detailStaffId)
            return;
        breakdownDetails.push({ ...source, id: `${source.billItemId || source.billId}-${kind}-${breakdownDetails.length}`, kind,
            recipientCount, factor, unitRate, explanation, amount: source.basisAmount * factor / recipientCount });
    };
    // Certifications are tracked separately and never distributed as staff pay.
    let certificationPoolTotal = 0;
    let storeAttendantPoolTotal = 0;
    let unallocatedStoreAttendantPoolTotal = 0;
    // Helper function to check if attendance status counts toward commission pool
    // Per PDF Page 5: Present = Yes, Off / Off (half day) = Yes (counted in full).
    // Annual leave, Sick, Absent, Emergency = No.
    const isPresentForPool = (status) => {
        if (!status)
            return false;
        return ['PRESENT', 'OFF', 'OFF_HALF'].includes(status.toUpperCase());
    };
    // Base leader(s) for override (regardless of attendance)
    const baseLeaders = staffMembers.filter((s) => s.isBaseLeaderOverride);
    // 4. Process each day present in either bills or attendance (or between start and end)
    const allDates = new Set([...billsByDate.keys(), ...attendanceByDate.keys()]);
    for (const date of allDates) {
        const dayBills = billsByDate.get(date) || [];
        const dayAttendance = attendanceByDate.get(date) || [];
        const dayAttendanceMap = new Map(dayAttendance.map((a) => [a.staffMemberId, a.status]));
        if (usesCents(date)) {
            hasCentDates = true;
            const day = (0, iruveliCommissionDay_1.calculateIruveliDay)(propertyId, date, dayBills, staffMembers, dayAttendanceMap, diveOnlyOverride, detailStaffId);
            for (const [id, values] of day.amounts) {
                const row = centAmounts.get(id) ?? (0, iruveliCommissionDay_1.emptyCommissionCents)();
                for (const field of iruveliCommissionDay_1.commissionFields)
                    row[field] = (0, commissionMoney_1.addCents)(row[field], values[field]);
                centAmounts.set(id, row);
            }
            personalDetails.push(...day.personalDetails);
            breakdownDetails.push(...day.details);
            unallocatedCommissions.push(...day.unallocated);
            certificationCents = (0, commissionMoney_1.addCents)(certificationCents, day.certificationCents);
            retailCents = (0, commissionMoney_1.addCents)(retailCents, day.retailCents);
            unallocatedRetailCents = (0, commissionMoney_1.addCents)(unallocatedRetailCents, day.unallocatedRetailCents);
            continue;
        }
        const canReceiveCredit = (id) => {
            const staff = staffMap.get(id);
            return Boolean(staff && staff.hireDate <= date && (!staff.leavingDate || staff.leavingDate >= date) && !(0, staffEligibility_1.isExcludedFromCredit)(dayAttendanceMap.get(id)));
        };
        let dailyCoursePool = 0;
        let dailyDivePool = 0;
        const poolSources = [];
        // Process bills for this day
        for (const bill of dayBills) {
            // Process Tips (Page 7: Split equally among the staff you picked on the bill)
            if (bill.tipAmount > 0 && bill.tipStaffIdsJson) {
                try {
                    const tipStaffIds = [...new Set(JSON.parse(bill.tipStaffIdsJson))].filter(canReceiveCredit);
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
                }
                catch (e) {
                    console.error('Error parsing tipStaffIdsJson for bill', bill.id, e);
                }
            }
            // Process Line items: pools and personal commissions
            for (const line of bill.items) {
                // Ignore inconsistent historical cross-property item relations.
                if (line.item && line.item.propertyId !== propertyId)
                    continue;
                // Pool contributions
                const ownedItem = line.item?.propertyId === propertyId ? line.item : null;
                const hasSnapshot = line.poolTypeSnapshot !== null && line.poolTypeSnapshot !== undefined &&
                    typeof line.poolContributionAmount === 'number' && Number.isFinite(line.poolContributionAmount) && line.poolContributionAmount >= 0;
                const poolType = hasSnapshot ? line.poolTypeSnapshot : ownedItem?.poolType || 'NONE';
                // Null snapshots belong to legacy imports/records. Migration snapshots all
                // existing records before changing catalogue values; new bills save their own amount.
                const contribution = hasSnapshot ? line.poolContributionAmount :
                    ownedItem && Number.isFinite(ownedItem.poolContribution) && ownedItem.poolContribution >= 0 ? ownedItem.poolContribution * line.quantity : 0;
                if (poolType === 'COURSE_POOL') {
                    dailyCoursePool += contribution;
                }
                else if (poolType === 'DIVE_POOL') {
                    dailyDivePool += contribution;
                }
                else if (poolType === 'CERTIFICATION_POOL') {
                    certificationPoolTotal += contribution;
                }
                const source = { billId: bill.id, billItemId: line.id, checkNumber: bill.checkNumber, businessDate: date, itemName: line.itemName, quantity: line.quantity };
                // Only explicit saved snapshots participate; never backfill historical sales.
                const retailPool = line.storeAttendantRateSnapshot === storeAttendantPool_1.STORE_ATTENDANT_RETAIL_RATE &&
                    typeof line.storeAttendantPoolAmount === 'number' && Number.isFinite(line.storeAttendantPoolAmount) && line.storeAttendantPoolAmount > 0 ? line.storeAttendantPoolAmount : 0;
                if (retailPool > 0) {
                    storeAttendantPoolTotal += retailPool;
                    const recipients = staffMembers.filter(staff => (0, storeAttendantPool_1.isStoreAttendant)(staff.roleTitle) && canReceiveCredit(staff.id));
                    const shares = (0, storeAttendantPool_1.splitStorePool)(retailPool, recipients.map(staff => staff.id));
                    if (!shares.length)
                        unallocatedStoreAttendantPoolTotal += retailPool;
                    for (const share of shares) {
                        const entry = commissionMap.get(share.staffId);
                        entry.personalCommission += share.amount;
                        personalDetails.push({ id: `${line.id}-store-${share.staffId}`, checkNumber: bill.checkNumber, businessDate: date,
                            guestName: bill.guestName, roomNumber: bill.roomNumber, itemName: line.itemName, role: 'Store attendant (Retail 5% shared)',
                            staffId: share.staffId, staffName: entry.staffName, amount: share.amount });
                        if (share.staffId === detailStaffId)
                            breakdownDetails.push({ ...source, id: `${line.id}-STORE-${share.staffId}`, kind: 'PERSONAL',
                                basisAmount: retailPool, recipientCount: shares.length, factor: 1, amount: share.amount,
                                explanation: 'Saved 5% of Retail sales after discounts, before tax and service charge; shared equally among eligible Store attendants, with remaining cents allocated by staff ID.' });
                    }
                }
                if (detailStaffId && contribution > 0 && (poolType === 'COURSE_POOL' || poolType === 'DIVE_POOL'))
                    poolSources.push({ ...source, basisAmount: contribution, poolType });
                // Personal commission (fixed amounts to designated roles on line)
                if (line.personalCommissionsJson) {
                    try {
                        const rates = JSON.parse(line.personalCommissionsJson);
                        const discountFactor = line.commissionDiscountFactor ?? 1;
                        // Seller
                        if (line.sellerStaffId && canReceiveCredit(line.sellerStaffId) && typeof rates.seller === 'number' && Number.isFinite(rates.seller) && rates.seller > 0) {
                            const amt = Number(rates.seller) * line.quantity * discountFactor;
                            const entry = commissionMap.get(line.sellerStaffId);
                            if (entry)
                                entry.personalCommission += amt;
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
                            if (entry)
                                entry.personalCommission += amt;
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
                            for (const staffId of (0, instructorCredits_1.instructorIds)(line)) {
                                if (!canReceiveCredit(staffId))
                                    continue;
                                const amt = rates.instructor * line.quantity * discountFactor;
                                const entry = commissionMap.get(staffId);
                                if (entry)
                                    entry.personalCommission += amt;
                                addDetail(staffId, { ...source, basisAmount: amt }, 'PERSONAL', 'Full saved catalogue instructor rate × quantity × saved after-discount factor; paid to each selected instructor', 1, 1, rates.instructor);
                                personalDetails.push({ id: `${line.id}-instructor-${staffId}`, checkNumber: bill.checkNumber, businessDate: bill.businessDate,
                                    guestName: bill.guestName, roomNumber: bill.roomNumber, itemName: line.itemName, role: 'Instructor',
                                    staffId, staffName: staffMap.get(staffId)?.name || 'Staff', amount: amt });
                            }
                        }
                        // Each selected Photo staff member receives the saved rate in full.
                        if (typeof rates.photo === 'number' && Number.isFinite(rates.photo) && rates.photo > 0) {
                            for (const staffId of (0, photoCredits_1.photoIds)(line)) {
                                if (!canReceiveCredit(staffId))
                                    continue;
                                const amt = rates.photo * line.quantity * discountFactor;
                                const entry = commissionMap.get(staffId);
                                if (entry)
                                    entry.personalCommission += amt;
                                addDetail(staffId, { ...source, basisAmount: amt }, 'PERSONAL', 'Full saved Photo rate × quantity × saved after-discount factor; paid to each selected Photo staff member', 1, 1, rates.photo);
                                personalDetails.push({ id: `${line.id}-photo-${staffId}`, checkNumber: bill.checkNumber, businessDate: bill.businessDate,
                                    guestName: bill.guestName, roomNumber: bill.roomNumber, itemName: line.itemName,
                                    role: line.includesComplimentaryMedia ? 'Photo / Video' : 'Photo', staffId, staffName: staffMap.get(staffId)?.name || 'Staff', amount: amt });
                            }
                        }
                        // Video
                        if (line.videoStaffId && canReceiveCredit(line.videoStaffId) && typeof rates.video === 'number' && Number.isFinite(rates.video) && rates.video > 0) {
                            const amt = Number(rates.video) * line.quantity * discountFactor;
                            const entry = commissionMap.get(line.videoStaffId);
                            if (entry)
                                entry.personalCommission += amt;
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
                    }
                    catch (e) {
                        console.error('Error parsing personalCommissionsJson', line.id, e);
                    }
                }
            }
        }
        // Determine who was employed and present on this day
        const courseSharingStaffToday = staffMembers.filter((s) => {
            if (!s.isDiveStaff || !s.isCoursePoolSharing)
                return false;
            if (s.hireDate > date)
                return false;
            if (s.leavingDate && s.leavingDate < date)
                return false;
            const status = dayAttendanceMap.get(s.id);
            return isPresentForPool(status);
        });
        const diveSharingStaffToday = staffMembers.filter((s) => {
            if (!s.isDiveStaff || !s.isDivePoolSharing)
                return false;
            if (s.hireDate > date)
                return false;
            if (s.leavingDate && s.leavingDate < date)
                return false;
            const status = dayAttendanceMap.get(s.id);
            return isPresentForPool(status);
        });
        // 1. Course Pool Distribution
        if (dailyCoursePool > 0 && courseSharingStaffToday.length > 0) {
            const share = dailyCoursePool / courseSharingStaffToday.length;
            for (const s of courseSharingStaffToday) {
                const entry = commissionMap.get(s.id);
                if (entry)
                    entry.courseCommission += share;
                if (s.id === detailStaffId)
                    for (const source of poolSources.filter(source => source.poolType === 'COURSE_POOL')) {
                        addDetail(s.id, source, 'COURSE_POOL', 'Saved course pool contribution divided among eligible staff on this date', courseSharingStaffToday.length);
                    }
            }
        }
        // 2. Dive Pool Distribution
        if (dailyDivePool > 0 && diveSharingStaffToday.length > 0) {
            const share = dailyDivePool / diveSharingStaffToday.length;
            for (const s of diveSharingStaffToday) {
                const entry = commissionMap.get(s.id);
                if (entry)
                    entry.diveCommission += share;
                if (s.id === detailStaffId)
                    for (const source of poolSources.filter(source => source.poolType === 'DIVE_POOL')) {
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
                if (entry)
                    entry.overrideCommission += overrideShare;
                if (bl.id === detailStaffId)
                    for (const source of poolSources) {
                        addDetail(bl.id, source, 'OVERRIDE', 'Extra 10% of the saved pool contribution divided among employed base leaders', employedBaseLeaders.length, 0.10);
                    }
            }
        }
    }
    // Calculate totals and round figures to 2 decimal places
    const staffResults = Array.from(commissionMap.values())
        .map((r) => {
        const total = r.courseCommission +
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
        if (!hasCentDates)
            return legacy;
        const cents = (0, iruveliCommissionDay_1.emptyCommissionCents)();
        const additions = centAmounts.get(r.staffId) ?? (0, iruveliCommissionDay_1.emptyCommissionCents)();
        for (const field of iruveliCommissionDay_1.commissionFields)
            cents[field] = (0, commissionMoney_1.addCents)((0, commissionMoney_1.productCents)(legacy[field]), additions[field]);
        // Preserve legacy payroll totals, including their historical component rounding.
        cents.totalCommission = (0, commissionMoney_1.addCents)((0, commissionMoney_1.productCents)(legacy.totalCommission), ...iruveliCommissionDay_1.commissionFields.map(field => additions[field]));
        return { ...legacy, ...Object.fromEntries([...iruveliCommissionDay_1.commissionFields, 'totalCommission'].map(field => [field, cents[field] / 100])), cents };
    })
        .sort((a, b) => b.totalCommission - a.totalCommission);
    const grandTotal = hasCentDates ? (0, commissionMoney_1.addCents)(...staffResults.map(row => row.cents.totalCommission)) / 100 : staffResults.reduce((acc, curr) => acc + curr.totalCommission, 0);
    return {
        staffResults,
        personalDetails,
        breakdownDetails,
        certificationPoolTotal: hasCentDates ? (0, commissionMoney_1.addCents)((0, commissionMoney_1.productCents)(Math.round(certificationPoolTotal * 100) / 100), certificationCents) / 100 : Math.round(certificationPoolTotal * 100) / 100,
        storeAttendantPoolTotal: hasCentDates ? (0, commissionMoney_1.addCents)((0, commissionMoney_1.productCents)(Math.round(storeAttendantPoolTotal * 100) / 100), retailCents) / 100 : Math.round(storeAttendantPoolTotal * 100) / 100,
        unallocatedStoreAttendantPoolTotal: hasCentDates ? (0, commissionMoney_1.addCents)((0, commissionMoney_1.productCents)(Math.round(unallocatedStoreAttendantPoolTotal * 100) / 100), unallocatedRetailCents) / 100 : Math.round(unallocatedStoreAttendantPoolTotal * 100) / 100,
        ...(hasCentDates ? { calculationVersion: 'IRUVELI_CENTS_V1', unallocatedCommissions } : {}),
        grandTotal: hasCentDates ? grandTotal : Math.round(grandTotal * 100) / 100,
    };
};
exports.calculateCommissionForPeriod = calculateCommissionForPeriod;
