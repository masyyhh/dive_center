import type { CommissionBill, CommissionBreakdownDetail, PersonalCommissionDetail } from './commissionService';
import { instructorIds } from '../utils/instructorCredits';
import { photoIds } from '../utils/photoCredits';
import { isExcludedFromCredit } from '../utils/staffEligibility';
import { isStoreAttendant, STORE_ATTENDANT_RETAIL_RATE } from '../utils/storeAttendantPool';
import { addCents, productCents, roundRatio, splitCommissionCents, sumProductCents } from '../utils/commissionMoney';

// Fixed rollout boundary: historical dates and locked months retain the legacy engine.
export const IRUVELI_CENTS_EFFECTIVE_DATE = process.env.IRUVELI_COMMISSION_EFFECTIVE_DATE || '2026-11-17';
export const commissionFields = [
  'courseCommission',
  'diveCommission',
  'overrideCommission',
  'tipsCommission',
  'personalCommission',
] as const;
export type CommissionField = (typeof commissionFields)[number];
export type CommissionCents = Record<CommissionField | 'totalCommission', number>;
export const emptyCommissionCents = (): CommissionCents => ({
  courseCommission: 0,
  diveCommission: 0,
  overrideCommission: 0,
  tipsCommission: 0,
  personalCommission: 0,
  totalCommission: 0,
});
type Staff = {
  id: string;
  name: string;
  roleTitle: string;
  hireDate: string;
  leavingDate: string | null;
  isDiveStaff: boolean;
  isCoursePoolSharing: boolean;
  isDivePoolSharing: boolean;
  isBaseLeaderOverride: boolean;
};
export interface UnallocatedCommission {
  businessDate: string;
  sourceId: string;
  kind: CommissionBreakdownDetail['kind'];
  amountCents: number;
  reason: string;
}

/** One day's authoritative cent entitlements. Never writes or recalculates saved trip pay. */
export function calculateIruveliDay(
  propertyId: string,
  date: string,
  bills: CommissionBill[],
  staff: Staff[],
  attendance: Map<string, string>,
  diveOnlyOverride: boolean,
  detailStaffId?: string,
) {
  const amounts = new Map<string, CommissionCents>();
  const details: CommissionBreakdownDetail[] = [];
  const personalDetails: PersonalCommissionDetail[] = [];
  const unallocated: UnallocatedCommission[] = [];
  const employed = (person: Staff) => person.hireDate <= date && (!person.leavingDate || person.leavingDate >= date);
  const eligible = (person: Staff) => employed(person) && !isExcludedFromCredit(attendance.get(person.id));
  const eligibleIds = new Set(staff.filter(eligible).map((person) => person.id));
  const course: number[][] = [],
    dive: number[][] = [];
  const courseSources: string[] = [],
    diveSources: string[] = [];
  let certificationCents = 0,
    retailCents = 0,
    unallocatedRetailCents = 0;
  const credit = (staffId: string, field: CommissionField, value: number) => {
    const row = amounts.get(staffId) ?? emptyCommissionCents();
    row[field] = addCents(row[field], value);
    amounts.set(staffId, row);
  };
  const detail = (
    staffId: string,
    source: Omit<CommissionBreakdownDetail, 'id' | 'amount' | 'amountCents'>,
    value: number,
  ) => {
    if (staffId === detailStaffId)
      details.push({
        ...source,
        id: `${date}-${source.billItemId || source.billId}-${source.kind}-${details.length}`,
        amount: value / 100,
        amountCents: value,
      });
  };
  const distribute = (
    value: number,
    ids: string[],
    field: CommissionField,
    source: Omit<CommissionBreakdownDetail, 'id' | 'amount' | 'amountCents'>,
  ) => {
    const result = splitCommissionCents(value, ids);
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
      let ids: string[] = [];
      try {
        const parsed: unknown = JSON.parse(bill.tipStaffIdsJson || '[]');
        if (Array.isArray(parsed))
          ids = parsed.filter((id): id is string => typeof id === 'string' && eligibleIds.has(id));
      } catch {
        /* Preserve the entire tip as unallocated if historical recipient JSON is invalid. */
      }
      distribute(productCents(bill.tipAmount), ids, 'tipsCommission', {
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
      if (line.item && line.item.propertyId !== propertyId) continue;
      const snapshot =
        line.poolTypeSnapshot != null &&
        typeof line.poolContributionAmount === 'number' &&
        Number.isFinite(line.poolContributionAmount) &&
        line.poolContributionAmount >= 0;
      const poolType = snapshot ? line.poolTypeSnapshot : line.item?.poolType || 'NONE';
      const contribution = snapshot
        ? [line.poolContributionAmount!]
        : line.item && Number.isFinite(line.item.poolContribution) && line.item.poolContribution >= 0
          ? [line.item.poolContribution, line.quantity]
          : [0];
      if (poolType === 'COURSE_POOL') {
        course.push(contribution);
        courseSources.push(line.id);
      } else if (poolType === 'DIVE_POOL') {
        dive.push(contribution);
        diveSources.push(line.id);
      } else if (poolType === 'CERTIFICATION_POOL')
        certificationCents = addCents(certificationCents, productCents(...contribution));
      const source = {
        billId: bill.id,
        billItemId: line.id,
        checkNumber: bill.checkNumber,
        businessDate: date,
        itemName: line.itemName,
        quantity: line.quantity,
      };
      if (
        line.storeAttendantRateSnapshot === STORE_ATTENDANT_RETAIL_RATE &&
        typeof line.storeAttendantPoolAmount === 'number' &&
        Number.isFinite(line.storeAttendantPoolAmount) &&
        line.storeAttendantPoolAmount > 0
      ) {
        const value = productCents(line.storeAttendantPoolAmount);
        retailCents = addCents(retailCents, value);
        const result = distribute(
          value,
          staff.filter((person) => eligible(person) && isStoreAttendant(person.roleTitle)).map((person) => person.id),
          'personalCommission',
          {
            ...source,
            basisAmount: value / 100,
            kind: 'PERSONAL',
            recipientCount: 0,
            factor: 1,
            explanation: 'Saved Retail pool split in whole cents; remaining cents assigned by ascending staff ID.',
          },
        );
        unallocatedRetailCents = addCents(unallocatedRetailCents, result.unallocatedCents);
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
            staffName: staff.find((person) => person.id === share.staffId)!.name,
            amount: share.amountCents / 100,
            amountCents: share.amountCents,
          });
      }
      let rates: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(line.personalCommissionsJson || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rates = parsed as Record<string, unknown>;
      } catch {
        /* Invalid saved rates earn no personal commission. */
      }
      const roles = [
        ['seller', 'Seller', line.sellerStaffId ? [line.sellerStaffId] : []],
        ['guide', 'Guide', line.guideStaffId ? [line.guideStaffId] : []],
        ['instructor', 'Instructor', instructorIds(line)],
        ['photo', line.includesComplimentaryMedia ? 'Photo / Video' : 'Photo', photoIds(line)],
        ['video', 'Video', line.videoStaffId ? [line.videoStaffId] : []],
      ] as const;
      for (const [role, label, ids] of roles) {
        const rate = rates[role];
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) continue;
        const value = productCents(rate, line.quantity, line.commissionDiscountFactor ?? 1);
        for (const id of ids) {
          if (!eligibleIds.has(id)) continue;
          credit(id, 'personalCommission', value);
          detail(
            id,
            {
              ...source,
              basisAmount: value / 100,
              kind: 'PERSONAL',
              recipientCount: 1,
              factor: 1,
              unitRate: rate,
              explanation: `${label} full saved rate × quantity × saved discount factor; rounded half up once per recipient.`,
            },
            value,
          );
          personalDetails.push({
            id: `${line.id}-${role}-${id}`,
            checkNumber: bill.checkNumber,
            businessDate: date,
            guestName: bill.guestName,
            roomNumber: bill.roomNumber,
            itemName: line.itemName,
            role: label,
            staffId: id,
            staffName: staff.find((person) => person.id === id)!.name,
            amount: value / 100,
            amountCents: value,
          });
        }
      }
    }
  }
  const courseCents = sumProductCents(course),
    diveCents = sumProductCents(dive);
  const poolStaff = (field: 'isCoursePoolSharing' | 'isDivePoolSharing') =>
    staff
      .filter(
        (person) =>
          employed(person) &&
          person.isDiveStaff &&
          person[field] &&
          ['PRESENT', 'OFF', 'OFF_HALF'].includes(attendance.get(person.id)?.toUpperCase() ?? ''),
      )
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
  ] as const) {
    if (value)
      distribute(value, [...ids], field, {
        ...dailySource,
        kind,
        sourceBillItemIds: kind === 'COURSE_POOL' ? courseSources : diveSources,
        itemName: `Daily ${kind === 'COURSE_POOL' ? 'course' : 'dive'} pool`,
        basisAmount: value / 100,
        explanation:
          'Daily saved contributions rounded once, then split in whole cents; remaining cents assigned by ascending staff ID.',
      });
  }
  const overrideBasis = diveOnlyOverride ? diveCents : addCents(courseCents, diveCents);
  const overrideCents = roundRatio(BigInt(overrideBasis), 10n);
  if (overrideCents)
    distribute(
      overrideCents,
      staff
        .filter(
          (person) =>
            employed(person) && person.isBaseLeaderOverride && attendance.get(person.id)?.toUpperCase() !== 'BASIC',
        )
        .map((person) => person.id),
      'overrideCommission',
      {
        ...dailySource,
        kind: 'OVERRIDE',
        sourceBillItemIds: diveOnlyOverride ? diveSources : [...courseSources, ...diveSources],
        itemName: 'Daily leader override',
        basisAmount: overrideBasis / 100,
        factor: 0.1,
        explanation:
          'Additional 10% of the applicable daily pool rounded half up once, then split in whole cents by ascending staff ID.',
      },
    );
  return { amounts, details, personalDetails, unallocated, certificationCents, retailCents, unallocatedRetailCents };
}
