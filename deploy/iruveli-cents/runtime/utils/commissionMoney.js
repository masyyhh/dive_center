"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareStaffIds = void 0;
exports.checkedCents = checkedCents;
exports.addCents = addCents;
exports.roundRatio = roundRatio;
exports.productCents = productCents;
exports.sumDecimalCents = sumDecimalCents;
exports.sumProductCents = sumProductCents;
exports.splitCommissionCents = splitCommissionCents;
exports.formatCents = formatCents;
function decimal(value) {
    const text = String(value);
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match || !Number.isFinite(Number(text)))
        throw new RangeError('Invalid commission amount.');
    const fraction = match[2] ?? '';
    const scale = fraction.length - Number(match[3] ?? 0);
    const units = BigInt(match[1] + fraction);
    return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}
function checkedCents(value) {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
        throw new RangeError('Commission exceeds supported cents.');
    return Number(value);
}
function addCents(...values) {
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
        throw new RangeError('Invalid commission cents.');
    return checkedCents(values.reduce((sum, value) => sum + BigInt(value), 0n));
}
function roundRatio(numerator, denominator) {
    if (numerator < 0n || denominator <= 0n)
        throw new RangeError('Invalid commission ratio.');
    return checkedCents((numerator * 2n + denominator) / (denominator * 2n));
}
function cents(value) {
    return roundRatio(value.units * 100n, 10n ** BigInt(value.scale));
}
function product(values) {
    return values
        .map(decimal)
        .reduce((a, b) => ({ units: a.units * b.units, scale: a.scale + b.scale }), { units: 1n, scale: 0 });
}
function productCents(...values) {
    return cents(product(values));
}
/** Round the sum once, rather than rounding each pool contribution. */
function sumDecimalCents(values) {
    return sumProductCents(values.map((value) => [value]));
}
function sumProductCents(values) {
    const parts = values.map(product);
    const scale = Math.max(0, ...parts.map((part) => part.scale));
    return cents({ units: parts.reduce((sum, part) => sum + part.units * 10n ** BigInt(scale - part.scale), 0n), scale });
}
const compareStaffIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
exports.compareStaffIds = compareStaffIds;
function splitCommissionCents(totalCents, staffIds) {
    addCents(totalCents);
    const ids = [...new Set(staffIds)].sort(exports.compareStaffIds);
    const count = BigInt(ids.length);
    const shares = ids.map((staffId, index) => ({
        staffId,
        amountCents: Number(BigInt(totalCents) / count) + (BigInt(index) < BigInt(totalCents) % count ? 1 : 0),
    }));
    return { shares, unallocatedCents: ids.length ? 0 : totalCents };
}
function formatCents(value) {
    addCents(value);
    const amount = BigInt(value);
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}
