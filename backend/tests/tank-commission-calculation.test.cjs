const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const { calculateTankCommission: calculate, tankRuleConfigSchema } = loadTypeScript('src/utils/tankCommission.ts');
const counts = { tanks: 16, passengers: 8, dives: 2, gearWash: 8, manualTotalCents: null, isComplimentary: false, isTraining: false };
const people = Array.from({ length: 5 }, (_, i) => ({ staffId: `staff-${i}`, role: i < 3 ? 'Boat crew' : 'Compressor' }));
const config = patch => ({ basis: 'TANK', rate: 1, distribution: 'EQUAL', missingPolicy: 'BLOCK', roles: [{ name: 'Boat crew', slots: 3, value: 1 }, { name: 'Compressor', slots: 2, value: 1 }], payComplimentary: false, payTraining: false, allowOverrides: false, ...patch });
test('workbook boat and house-reef examples allocate exactly the total pool', () => {
  const boat = calculate(config(), counts, people);
  assert.equal(boat.totalCents, 1600); assert.deepEqual(boat.allocations.map(row => row.amountCents), [320, 320, 320, 320, 320]);
  const house = calculate(config({ roles: [{ name: 'Compressor', slots: 2, value: 1 }] }), { ...counts, tanks: 3 }, people.slice(3));
  assert.deepEqual(house.allocations.map(row => row.amountCents), [150, 150]);
});
test('unknown rates block calculation and explicit zero is retained', () => {
  assert.throws(() => calculate(config({ rate: null }), counts, people), /setup required/);
  assert.equal(calculate(config({ rate: 0 }), counts, people).totalCents, 0);
  assert.throws(() => calculate(config({ distribution: 'FIXED', roles: [{ name: 'Boat crew', slots: 3, value: null }] }), counts, people.slice(0, 3)), /setup required/);
});
test('vacant slots can block, remain unpaid, or redistribute without losing cents', () => {
  assert.throws(() => calculate(config(), counts, people.slice(0, 3)), /every recipient slot/);
  const vacant = calculate(config({ missingPolicy: 'UNALLOCATED' }), counts, people.slice(0, 3));
  assert.equal(vacant.unallocatedCents, 640);
  const redistributed = calculate(config({ missingPolicy: 'REDISTRIBUTE' }), counts, people.slice(0, 3));
  assert.deepEqual(redistributed.allocations.map(row => row.amountCents), [534, 533, 533]);
  assert.equal(redistributed.unallocatedCents, 0);
});
test('rounding is deterministic when recipients are reordered', () => {
  const first = calculate(config({ rate: 0.01 }), { ...counts, tanks: 1 }, people);
  const reverse = calculate(config({ rate: 0.01 }), { ...counts, tanks: 1 }, [...people].reverse());
  assert.deepEqual(first, reverse);
  assert.equal(first.allocations.reduce((sum, row) => sum + row.amountCents, 0), 1);
});
test('weighted and percentage methods apply per recipient slot', () => {
  const roles = [{ name: 'Boat crew', slots: 3, value: 2 }, { name: 'Compressor', slots: 2, value: 1 }];
  assert.deepEqual(calculate(config({ distribution: 'WEIGHTED', roles }), counts, people).allocations.map(row => row.amountCents), [400, 400, 400, 200, 200]);
  const percentages = [{ name: 'Boat crew', slots: 3, value: 20 }, { name: 'Compressor', slots: 2, value: 20 }];
  assert.equal(calculate(config({ distribution: 'PERCENTAGE', roles: percentages }), counts, people).totalCents, 1600);
  assert.equal(tankRuleConfigSchema.safeParse(config({ distribution: 'PERCENTAGE', roles })).success, false);
});
test('fixed payments support different quantity bases and unpaid vacancies', () => {
  const rule = config({ distribution: 'FIXED', rate: null, missingPolicy: 'UNALLOCATED', roles: [{ name: 'Boat crew', slots: 3, value: 5, basis: 'TRIP' }, { name: 'Compressor', slots: 2, value: 0.25, basis: 'TANK' }] });
  const result = calculate(rule, counts, people.slice(0, 4));
  assert.equal(result.totalCents, 2300); assert.equal(result.unallocatedCents, 400);
  assert.deepEqual(result.allocations.map(row => row.amountCents), [500, 500, 500, 400]);
});
test('manual, passenger, dive and gear-wash totals use their own quantities', () => {
  for (const [basis, total] of [['PASSENGER', 800], ['DIVE', 200], ['GEAR_WASH', 800], ['TRIP', 100]]) assert.equal(calculate(config({ basis }), counts, people).totalCents, total);
  assert.throws(() => calculate(config({ basis: 'MANUAL' }), counts, people), /manual commission total/);
  assert.equal(calculate(config({ basis: 'MANUAL' }), { ...counts, manualTotalCents: 1234 }, people).totalCents, 1234);
});
test('complimentary and training rules exclude sessions unless explicitly enabled', () => {
  assert.equal(calculate(config(), { ...counts, isComplimentary: true }, people).totalCents, 0);
  assert.equal(calculate(config(), { ...counts, isTraining: true }, people).totalCents, 0);
  assert.equal(calculate(config({ payTraining: true }), { ...counts, isTraining: true }, people).totalCents, 1600);
});
test('duplicate employees, unknown roles, invalid weights and excess amounts are rejected', () => {
  assert.throws(() => calculate(config(), counts, [people[0], people[0]]), /only once/);
  assert.throws(() => calculate(config(), counts, [{ staffId: 'x', role: 'Unknown' }]), /does not exist/);
  assert.equal(tankRuleConfigSchema.safeParse(config({ distribution: 'WEIGHTED', roles: [{ name: 'Role', slots: 1, value: 0 }] })).success, false);
  assert.equal(tankRuleConfigSchema.safeParse(config({ roles: [{ name: 'Role', slots: 1, value: 1 }, { name: 'role', slots: 1, value: 1 }] })).success, false);
  assert.throws(() => calculate(config({ rate: 100000 }), { ...counts, tanks: 100000 }, people), /supported amount/);
});

const combined = patch => config({ basis: 'COMBINED', rate: null, rates: { tanks: 1.25, passengers: 2, gearWash: 0.5 }, ...patch });
test('combined trip pool adds Tanks, Pax and Gear Wash and allocates exact Com/per', () => {
  const result = calculate(combined(), counts, people);
  assert.equal(result.totalCents, 4000); // 16 × 1.25 + 8 × 2 + 8 × 0.5
  assert.deepEqual(result.allocations.map(row => row.amountCents), [800, 800, 800, 800, 800]);
  assert.equal(result.allocations.reduce((sum, row) => sum + row.amountCents, 0), result.totalCents);
});
test('combined pools retain weighted and percentage role distribution', () => {
  const weighted = calculate(combined({ distribution: 'WEIGHTED', roles: [{ name: 'Boat crew', slots: 3, value: 2 }, { name: 'Compressor', slots: 2, value: 1 }] }), counts, people);
  assert.deepEqual(weighted.allocations.map(row => row.amountCents), [1000, 1000, 1000, 500, 500]);
  const percentage = calculate(combined({ distribution: 'PERCENTAGE', roles: [{ name: 'Boat crew', slots: 3, value: 20 }, { name: 'Compressor', slots: 2, value: 20 }] }), counts, people);
  assert.deepEqual(percentage.allocations.map(row => row.amountCents), [800, 800, 800, 800, 800]);
});
test('combined pool rounds once after summing all metric rates and retains deterministic cents', () => {
  const raw = combined({ rates: { tanks: 0.005, passengers: 0.005, gearWash: 0.005 } });
  const inputs = { ...counts, tanks: 1, passengers: 1, gearWash: 1 };
  const result = calculate(raw, inputs, people);
  assert.equal(result.totalCents, 2);
  assert.deepEqual(result, calculate(raw, inputs, [...people].reverse()));
  assert.equal(result.allocations.reduce((sum, row) => sum + row.amountCents, 0), 2);
});
test('combined pool rejects missing rates, invalid metric values and overflow; explicit zeros remain valid', () => {
  for (const rates of [undefined, { tanks: null, passengers: 2, gearWash: 0.5 }, { tanks: 1, passengers: null, gearWash: 0.5 }, { tanks: 1, passengers: 2, gearWash: null }]) assert.throws(() => calculate(combined({ rates }), counts, people), /setup required/);
  assert.equal(calculate(combined({ rates: { tanks: 0, passengers: 0, gearWash: 0 } }), counts, people).totalCents, 0);
  for (const key of ['tanks', 'passengers', 'gearWash']) assert.throws(() => calculate(combined(), { ...counts, [key]: -1 }, people), /whole numbers/);
  assert.throws(() => calculate(combined({ rates: { tanks: 100000, passengers: 100000, gearWash: 100000 } }), { ...counts, tanks: 100000 }, people), /supported amount/);
});
test('combined pools preserve vacancies and complimentary/training exclusions', () => {
  const vacant = calculate(combined({ missingPolicy: 'UNALLOCATED' }), counts, people.slice(0, 4));
  assert.equal(vacant.unallocatedCents, 800);
  assert.equal(vacant.allocations.reduce((sum, row) => sum + row.amountCents, 0) + vacant.unallocatedCents, vacant.totalCents);
  assert.equal(calculate(combined(), { ...counts, isComplimentary: true }, people).totalCents, 0);
  assert.equal(calculate(combined(), { ...counts, isTraining: true }, people).totalCents, 0);
});

const { equalTankTripConfig } = loadTypeScript('src/utils/tankCommission.ts');
test('daily trip Excel formula pays 16 tanks / 5 staff = 3.20 each', () => {
  const crew = people.map((person, i) => ({ ...person, role: i === 0 ? 'Captain' : i < 3 ? 'Crew' : 'Compressor Attendant' }));
  const result = calculate(equalTankTripConfig(crew), counts, crew);
  assert.equal(result.totalCents, 1600);
  assert.equal(result.unallocatedCents, 0);
  assert.deepEqual(result.allocations.map(row => row.amountCents), [320, 320, 320, 320, 320]);
  assert.deepEqual(result, calculate(equalTankTripConfig([...crew].reverse()), { ...counts, passengers: 999, gearWash: 999, isComplimentary: true, isTraining: true }, [...crew].reverse()));
});
test('daily trip equal sharing rounds leftover cents deterministically and requires actual crew', () => {
  const crew = people.slice(0, 3);
  const result = calculate(equalTankTripConfig(crew), counts, crew);
  assert.deepEqual(result.allocations.map(row => row.amountCents), [534, 533, 533]);
  assert.equal(result.allocations.reduce((sum, row) => sum + row.amountCents, 0), 1600);
  assert.throws(() => equalTankTripConfig([]), /crew member/);
  assert.throws(() => calculate(equalTankTripConfig([crew[0], crew[0]]), counts, [crew[0], crew[0]]), /only once/);
});
