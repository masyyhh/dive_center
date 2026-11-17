"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyCommissionCents = exports.commissionFields = exports.IRUVELI_CENTS_EFFECTIVE_DATE = void 0;
exports.calculateIruveliDay = calculateIruveliDay;
const instructorCredits_1 = require("../utils/instructorCredits");
const photoCredits_1 = require("../utils/photoCredits");
const staffEligibility_1 = require("../utils/staffEligibility");
const storeAttendantPool_1 = require("../utils/storeAttendantPool");
const commissionMoney_1 = require("../utils/commissionMoney");
// Fixed rollout boundary: historical dates and locked months retain the legacy engine.
exports.IRUVELI_CENTS_EFFECTIVE_DATE = process.env.IRUVELI_COMMISSION_EFFECTIVE_DATE || '2026-11-17';
exports.commissionFields = [
    'courseCommission',
    'diveCommission',
    'overrideCommission',
    'tipsCommission',
    'personalCommission',
];
const emptyCommissionCents = () => ({
    courseCommission: 0,
    diveCommission: 0,
    overrideCommission: 0,
    tipsCommission: 0,
    personalCommission: 0,
    totalCommission: 0,
});
exports.emptyCommissionCents = emptyCommissionCents;
/** One day's authoritative cent entitlements. Never writes or recalculates saved trip pay. */
function calculateIruveliDay(propertyId, date, bills, staff, attendance, diveOnlyOverride, detailStaffId) {
    const amounts = new Map();
    const details = [];
    const personalDetails = [];
    const unallocated = [];
    const employed = (person) => person.hireDate <= date && (!person.leavingDate || person.leavingDate >= date);
    const eligible = (person) => employed(person) && !(0, staffEligibility_1.isExcludedFromCredit)(attendance.get(person.id));
    const eligibleIds = new Set(staff.filter(eligible).map((person) => person.id));
    const course = [], dive = [];
    const courseSources = [], diveSources = [];
    let certificationCents = 0, retailCents = 0, unallocatedRetailCents = 0;
    const credit = (staffId, field, value) => {
        const row = amounts.get(staffId) ?? (0, exports.emptyCommissionCents)();
        row[field] = (0, commissionMoney_1.addCents)(row[field], value);
        amounts.set(staffId, row);
    };
    const detail = (staffId, source, value) => {
        if (staffId === detailStaffId)
            details.push({
                ...source,
                id: `${date}-${source.billItemId || source.billId}-${source.kind}-${details.length}`,
                amount: value / 100,
                amountCents: value,
            });
    };
    const distribute = (value, ids, field, source) => {
        const result = (0, commissionMoney_1.splitCommissionCents)(value, ids);
        if (result.unallocatedCents)
            unallocated.push({
                businessDate: date,
                sourceId: source.billItemId || source.billId || date,
                kind: source.kind,
                amountCents: result.unallocatedCents,
                reason: 'No eligible recipients',
            });
        for (const share of result.shares) {
            credit(share.staffId, field, share.amountCents);
            detail(share.staffId, { ...source, recipientCount: result.shares.length }, share.amountCents);
        }
        return result;
    };
    for (const bill of bills) {
        if (bill.tipAmount > 0) {
            let ids = [];
            try {
                const parsed = JSON.parse(bill.tipStaffIdsJson || '[]');
                if (Array.isArray(parsed))
                    ids = parsed.filter((id) => typeof id === 'string' && eligibleIds.has(id));
            }
            catch {
                /* Preserve the entire tip as unallocated if historical recipient JSON is invalid. */
            }
            distribute((0, commissionMoney_1.productCents)(bill.tipAmount), ids, 'tipsCommission', {
                billId: bill.id,
                billItemId: null,
                checkNumber: bill.checkNumber,
                businessDate: date,
                itemName: 'Bill tip',
                quantity: null,
                basisAmount: bill.tipAmount,
                kind: 'TIPS',
                recipientCount: 0,
                factor: 1,
                explanation: 'Bill tip split in whole cents; remaining cents assigned by ascending staff ID.',
            });
        }
        for (const line of bill.items) {
            if (line.item && line.item.propertyId !== propertyId)
                continue;
            const snapshot = line.poolTypeSnapshot != null &&
                typeof line.poolContributionAmount === 'number' &&
                Number.isFinite(line.poolContributionAmount) &&
                line.poolContributionAmount >= 0;
            const poolType = snapshot ? line.poolTypeSnapshot : line.item?.poolType || 'NONE';
            const contribution = snapshot
                ? [line.poolContributionAmount]
                : line.item && Number.isFinite(line.item.poolContribution) && line.item.poolContribution >= 0
                    ? [line.item.poolContribution, line.quantity]
                    : [0];
            if (poolType === 'COURSE_POOL') {
                course.push(contribution);
                courseSources.push(line.id);
            }
            else if (poolType === 'DIVE_POOL') {
                dive.push(contribution);
                diveSources.push(line.id);
            }
            else if (poolType === 'CERTIFICATION_POOL')
                certificationCents = (0, commissionMoney_1.addCents)(certificationCents, (0, commissionMoney_1.productCents)(...contribution));
            const source = {
                billId: bill.id,
                billItemId: line.id,
                checkNumber: bill.checkNumber,
                businessDate: date,
                itemName: line.itemName,
                quantity: line.quantity,
            };
            if (line.storeAttendantRateSnapshot === storeAttendantPool_1.STORE_ATTENDANT_RETAIL_RATE &&
                typeof line.storeAttendantPoolAmount === 'number' &&
                Number.isFinite(line.storeAttendantPoolAmount) &&
                line.storeAttendantPoolAmount > 0) {
                const value = (0, commissionMoney_1.productCents)(line.storeAttendantPoolAmount);
                retailCents = (0, commissionMoney_1.addCents)(retailCents, value);
                const result = distribute(value, staff.filter((person) => eligible(person) && (0, storeAttendantPool_1.isStoreAttendant)(person.roleTitle)).map((person) => person.id), 'personalCommission', {
                    ...source,
                    basisAmount: value / 100,
                    kind: 'PERSONAL',
                    recipientCount: 0,
                    factor: 1,
                    explanation: 'Saved Retail pool split in whole cents; remaining cents assigned by ascending staff ID.',
                });
                unallocatedRetailCents = (0, commissionMoney_1.addCents)(unallocatedRetailCents, result.unallocatedCents);
                for (const share of result.shares)
                    personalDetails.push({
                        id: `${line.id}-store-${share.staffId}`,
                        checkNumber: bill.checkNumber,
                        businessDate: date,
                        guestName: bill.guestName,
                        roomNumber: bill.roomNumber,
                        itemName: line.itemName,
                        role: 'Store attendant (Retail 5% shared)',
                        staffId: share.staffId,
                        staffName: staff.find((person) => person.id === share.staffId).name,
                        amount: share.amountCents / 100,
                        amountCents: share.amountCents,
                    });
            }
            let rates = {};
            try {
                const parsed = JSON.parse(line.personalCommissionsJson || '{}');
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                    rates = parsed;
            }
            catch {
                /* Invalid saved rates earn no personal commission. */
            }
            const roles = [
                ['seller', 'Seller', line.sellerStaffId ? [line.sellerStaffId] : []],
                ['guide', 'Guide', line.guideStaffId ? [line.guideStaffId] : []],
                ['instructor', 'Instructor', (0, instructorCredits_1.instructorIds)(line)],
                ['photo', line.includesComplimentaryMedia ? 'Photo / Video' : 'Photo', (0, photoCredits_1.photoIds)(line)],
                ['video', 'Video', line.videoStaffId ? [line.videoStaffId] : []],
            ];
            for (const [role, label, ids] of roles) {
                const rate = rates[role];
                if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
                    continue;
                const value = (0, commissionMoney_1.productCents)(rate, line.quantity, line.commissionDiscountFactor ?? 1);
                for (const id of ids) {
                    if (!eligibleIds.has(id))
                        continue;
                    credit(id, 'personalCommission', value);
                    detail(id, {
                        ...source,
                        basisAmount: value / 100,
                        kind: 'PERSONAL',
                        recipientCount: 1,
                        factor: 1,
                        unitRate: rate,
                        explanation: `${label} full saved rate × quantity × saved discount factor; rounded half up once per recipient.`,
                    }, value);
                    personalDetails.push({
                        id: `${line.id}-${role}-${id}`,
                        checkNumber: bill.checkNumber,
                        businessDate: date,
                        guestName: bill.guestName,
                        roomNumber: bill.roomNumber,
                        itemName: line.itemName,
                        role: label,
                        staffId: id,
                        staffName: staff.find((person) => person.id === id).name,
                        amount: value / 100,
                        amountCents: value,
                    });
                }
            }
        }
    }
    const courseCents = (0, commissionMoney_1.sumProductCents)(course), diveCents = (0, commissionMoney_1.sumProductCents)(dive);
    const poolStaff = (field) => staff
        .filter((person) => employed(person) &&
        person.isDiveStaff &&
        person[field] &&
        ['PRESENT', 'OFF', 'OFF_HALF'].includes(attendance.get(person.id)?.toUpperCase() ?? ''))
        .map((person) => person.id);
    const dailySource = {
        billId: '',
        billItemId: null,
        checkNumber: 0,
        businessDate: date,
        quantity: null,
        recipientCount: 0,
        factor: 1,
    };
    for (const [kind, field, value, ids] of [
        ['COURSE_POOL', 'courseCommission', courseCents, poolStaff('isCoursePoolSharing')],
        ['DIVE_POOL', 'diveCommission', diveCents, poolStaff('isDivePoolSharing')],
    ]) {
        if (value)
            distribute(value, [...ids], field, {
                ...dailySource,
                kind,
                sourceBillItemIds: kind === 'COURSE_POOL' ? courseSources : diveSources,
                itemName: `Daily ${kind === 'COURSE_POOL' ? 'course' : 'dive'} pool`,
                basisAmount: value / 100,
                explanation: 'Daily saved contributions rounded once, then split in whole cents; remaining cents assigned by ascending staff ID.',
            });
    }
    const overrideBasis = diveOnlyOverride ? diveCents : (0, commissionMoney_1.addCents)(courseCents, diveCents);
    const overrideCents = (0, commissionMoney_1.roundRatio)(BigInt(overrideBasis), 10n);
    if (overrideCents)
        distribute(overrideCents, staff
            .filter((person) => employed(person) && person.isBaseLeaderOverride && attendance.get(person.id)?.toUpperCase() !== 'BASIC')
            .map((person) => person.id), 'overrideCommission', {
            ...dailySource,
            kind: 'OVERRIDE',
            sourceBillItemIds: diveOnlyOverride ? diveSources : [...courseSources, ...diveSources],
            itemName: 'Daily leader override',
            basisAmount: overrideBasis / 100,
            factor: 0.1,
            explanation: 'Additional 10% of the applicable daily pool rounded half up once, then split in whole cents by ascending staff ID.',
        });
    return { amounts, details, personalDetails, unallocated, certificationCents, retailCents, unallocatedRetailCents };
}
