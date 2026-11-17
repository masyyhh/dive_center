/** Exact decimal arithmetic at earning boundaries; currency values are nonnegative. */
type Decimal = { units: bigint; scale: number };
function decimal(value: number | string): Decimal {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || !Number.isFinite(Number(text))) throw new RangeError('Invalid commission amount.');
  const fraction = match[2] ?? '';
  const scale = fraction.length - Number(match[3] ?? 0);
  const units = BigInt(match[1] + fraction);
  return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}
export function checkedCents(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Commission exceeds supported cents.');
  return Number(value);
}
export function addCents(...values: number[]): number {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new RangeError('Invalid commission cents.');
  return checkedCents(values.reduce((sum, value) => sum + BigInt(value), 0n));
}
export function roundRatio(numerator: bigint, denominator: bigint): number {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Invalid commission ratio.');
  return checkedCents((numerator * 2n + denominator) / (denominator * 2n));
}
function cents(value: Decimal): number {
  return roundRatio(value.units * 100n, 10n ** BigInt(value.scale));
}
function product(values: (number | string)[]): Decimal {
  return values
    .map(decimal)
    .reduce((a, b) => ({ units: a.units * b.units, scale: a.scale + b.scale }), { units: 1n, scale: 0 });
}
export function productCents(...values: (number | string)[]): number {
  return cents(product(values));
}
/** Round the sum once, rather than rounding each pool contribution. */
export function sumDecimalCents(values: number[]): number {
  return sumProductCents(values.map((value) => [value]));
}
export function sumProductCents(values: (number | string)[][]): number {
  const parts = values.map(product);
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  return cents({ units: parts.reduce((sum, part) => sum + part.units * 10n ** BigInt(scale - part.scale), 0n), scale });
}
export const compareStaffIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function splitCommissionCents(totalCents: number, staffIds: string[]) {
  addCents(totalCents);
  const ids = [...new Set(staffIds)].sort(compareStaffIds);
  const count = BigInt(ids.length);
  const shares = ids.map((staffId, index) => ({
    staffId,
    amountCents: Number(BigInt(totalCents) / count) + (BigInt(index) < BigInt(totalCents) % count ? 1 : 0),
  }));
  return { shares, unallocatedCents: ids.length ? 0 : totalCents };
}
export function formatCents(value: number): string {
  addCents(value);
  const amount = BigInt(value);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}
