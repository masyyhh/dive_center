import { z } from 'zod';
import { compareStaffIds } from './commissionMoney';

export const tankBasis = z.enum(['TANK', 'PASSENGER', 'DIVE', 'TRIP', 'GEAR_WASH', 'MANUAL', 'COMBINED']);
const amount = z.number().finite().min(0).max(100000).refine(value => Math.abs(value * 10000 - Math.round(value * 10000)) < 0.00001, 'Use up to four decimal places.');
export const tankRuleConfigSchema = z.object({
  basis: tankBasis,
  rate: amount.nullable(),
  rates: z.object({ tanks: amount.nullable(), passengers: amount.nullable(), gearWash: amount.nullable() }).strict().optional(),
  distribution: z.enum(['EQUAL', 'WEIGHTED', 'PERCENTAGE', 'FIXED']),
  missingPolicy: z.enum(['BLOCK', 'UNALLOCATED', 'REDISTRIBUTE']),
  roles: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    slots: z.number().int().min(1).max(50),
    value: amount.nullable(),
    basis: tankBasis.exclude(['MANUAL', 'COMBINED']).optional(),
  }).strict()).min(1).max(20),
  payComplimentary: z.boolean(),
  payTraining: z.boolean(),
  allowOverrides: z.boolean(),
}).strict().superRefine((config, ctx) => {
  if (new Set(config.roles.map(role => role.name.toLowerCase())).size !== config.roles.length) ctx.addIssue({ code: 'custom', message: 'Role names must be unique.' });
  if (config.roles.reduce((sum, role) => sum + role.slots, 0) > 50) ctx.addIssue({ code: 'custom', message: 'Use up to 50 recipient slots.' });
  if (config.distribution === 'PERCENTAGE' && (config.roles.some(role => role.value === null) || Math.abs(config.roles.reduce((sum, role) => sum + (role.value ?? 0) * role.slots, 0) - 100) > 0.000001)) ctx.addIssue({ code: 'custom', message: 'Percentages across all recipient slots must total 100%.' });
  if (config.distribution === 'WEIGHTED' && config.roles.some(role => role.value === null || role.value <= 0)) ctx.addIssue({ code: 'custom', message: 'Every role needs a positive weight.' });
  if (config.distribution === 'FIXED' && config.missingPolicy === 'REDISTRIBUTE') ctx.addIssue({ code: 'custom', message: 'Fixed payments cannot be redistributed. Choose block or leave unallocated.' });
});
export type TankRuleConfig = z.infer<typeof tankRuleConfigSchema>;
export const tankParticipantSchema = z.object({ staffId: z.string().min(1).max(100), role: z.string().trim().min(1).max(60) }).strict();
export type TankParticipant = z.infer<typeof tankParticipantSchema>;
export interface TankCounts {
  tanks: number; passengers: number; dives: number; gearWash: number;
  manualTotalCents: number | null;
  isComplimentary: boolean; isTraining: boolean;
}
const maxCents = 2_000_000_000;
function checkedCents(value: bigint): number {
  if (value < 0n || value > BigInt(maxCents)) throw new Error('Commission exceeds the supported amount.');
  return Number(value);
}
function units(basis: Exclude<TankRuleConfig['basis'], 'COMBINED'>, counts: TankCounts): number {
  const value = ({ TANK: counts.tanks, PASSENGER: counts.passengers, DIVE: counts.dives, TRIP: 1, GEAR_WASH: counts.gearWash, MANUAL: 1 })[basis];
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000) throw new Error('Activity counts must be whole numbers between 0 and 100,000.');
  return value;
}
function payment(rate: number, count: number): number {
  // Four decimal rate precision; round the final payment to whole cents.
  return checkedCents((BigInt(Math.round(rate * 10000)) * BigInt(count) + 50n) / 100n);
}

export function calculateTankCommission(raw: TankRuleConfig, counts: TankCounts, participants: TankParticipant[], staffIdRemainders = false) {
  const config = tankRuleConfigSchema.parse(raw);
  if (participants.length > 50 || new Set(participants.map(person => person.staffId)).size !== participants.length) throw new Error('Select each employee only once, with up to 50 recipients.');
  if (participants.some(person => !config.roles.some(role => role.name === person.role))) throw new Error('A selected role does not exist in this rule.');
  const assignments = config.roles.map(role => ({ ...role, people: participants.filter(person => person.role === role.name).sort((a, b) => a.staffId.localeCompare(b.staffId)) }));
  if (assignments.some(role => role.people.length > role.slots)) throw new Error('A role has more recipients than its configured slots.');
  if (config.missingPolicy === 'BLOCK' && assignments.some(role => role.people.length !== role.slots)) throw new Error('Assign every recipient slot before saving this trip.');
  if (!participants.length) throw new Error('Select at least one recipient before calculating commission.');
  const excluded = counts.isComplimentary && !config.payComplimentary || counts.isTraining && !config.payTraining;
  let totalCents = 0;
  let unallocatedCents = 0;
  const allocations: { staffId: string; role: string; amountCents: number }[] = [];
  if (config.distribution === 'FIXED') {
    for (const role of assignments) {
      if (role.value === null) throw new Error(`Commission setup required: enter a fixed rate for ${role.name}.`);
      const cents = excluded ? 0 : payment(role.value, units(role.basis ?? 'TRIP', counts));
      totalCents += cents * role.slots;
      unallocatedCents += cents * (role.slots - role.people.length);
      allocations.push(...role.people.map(person => ({ ...person, amountCents: cents })));
    }
  } else {
    if (config.basis === 'COMBINED') {
      let total = 0n;
      for (const [key, basis] of [['tanks', 'TANK'], ['passengers', 'PASSENGER'], ['gearWash', 'GEAR_WASH']] as const) {
        const rate = config.rates?.[key];
        if (rate === null || rate === undefined) throw new Error(`Commission setup required: enter the ${key === 'passengers' ? 'Pax' : key === 'gearWash' ? 'Gear Wash' : 'Tanks'} rate (use 0 for no contribution).`);
        total += BigInt(Math.round(rate * 10000)) * BigInt(units(basis, counts));
      }
      // Add all metric contributions at four-decimal precision, then round the pool once.
      totalCents = checkedCents((total + 50n) / 100n);
    } else if (config.basis === 'MANUAL') {
      if (counts.manualTotalCents === null || !Number.isSafeInteger(counts.manualTotalCents) || counts.manualTotalCents < 0) throw new Error('Enter a manual commission total.');
      totalCents = checkedCents(BigInt(counts.manualTotalCents));
    } else {
      if (config.rate === null) throw new Error('Commission setup required: enter a rate in the selected rule.');
      totalCents = payment(config.rate, units(config.basis, counts));
    }
    if (excluded) totalCents = 0;
    // Include vacant slots in the denominator unless the manager chose redistribution.
    const slots = assignments.flatMap(role => Array.from({ length: config.missingPolicy === 'REDISTRIBUTE' ? role.people.length : role.slots }, (_, index) => ({
      role: role.name, staffId: role.people[index]?.staffId ?? null,
      weight: BigInt(config.distribution === 'EQUAL' ? 10000 : Math.round(role.value! * 10000)),
      index,
    })));
    const denominator = slots.reduce((sum, slot) => sum + slot.weight, 0n);
    if (denominator <= 0n) throw new Error('Selected recipients have no commission weight.');
    const shares = slots.map((slot, index) => ({ ...slot, index, cents: Number(BigInt(totalCents) * slot.weight / denominator), remainder: BigInt(totalCents) * slot.weight % denominator }));
    let remainder = totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
    const sorted = [...shares].sort((a, b) => a.remainder === b.remainder
      ? staffIdRemainders
        ? a.staffId === null ? b.staffId === null ? a.index - b.index : 1 : b.staffId === null ? -1 : compareStaffIds(a.staffId, b.staffId)
        : a.index - b.index
      : a.remainder > b.remainder ? -1 : 1);
    for (const share of sorted) { if (remainder-- <= 0) break; share.cents++; }
    for (const share of shares) {
      if (share.staffId) allocations.push({ staffId: share.staffId, role: share.role, amountCents: share.cents });
      else unallocatedCents += share.cents;
    }
  }
  checkedCents(BigInt(totalCents));
  return { totalCents, unallocatedCents, allocations, excluded: Boolean(excluded) };
}

/** Daily trip rule: one unit of commission per tank, shared by the actual crew. */
export function equalTankTripConfig(participants: TankParticipant[]): TankRuleConfig {
  if (!participants.length) throw new Error('Select at least one crew member.');
  const roles = [...new Set(participants.map(person => person.role))].sort().map(name => ({
    name, slots: participants.filter(person => person.role === name).length, value: 1,
  }));
  return { basis: 'TANK', rate: 1, distribution: 'EQUAL', missingPolicy: 'BLOCK', roles,
    payComplimentary: true, payTraining: true, allowOverrides: false };
}
