import type { BillItem } from '../types';

export type PriceAdjustment = 'unitPrice' | 'lineTotal' | 'discountPercent';

/** Keep submitted unit prices, explicit discounts and displayed totals consistent. */
export function adjustBillLine(line: BillItem, kind: PriceAdjustment, value: number): BillItem {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(value * line.quantity * 100)) throw new Error('Enter a valid price of zero or more.');
  if (kind === 'discountPercent' && value > 100) throw new Error('Discount must be between 0 and 100%.');
  if (line.autoPhotoFor && kind !== 'discountPercent') throw new Error('Linked Photo prices are set by the property. Use a discount to adjust them.');
  let { unitPrice, discountPercent } = line;
  if (kind === 'unitPrice') unitPrice = value;
  if (kind === 'discountPercent') discountPercent = value;
  if (kind === 'lineTotal') {
    // A positive final price also clears an existing full discount.
    if (discountPercent === 100 && value > 0) discountPercent = 0;
    unitPrice = discountPercent === 100 ? unitPrice : value / line.quantity / (1 - discountPercent / 100);
  }
  const lineTotal = unitPrice * line.quantity * (1 - discountPercent / 100);
  if (!Number.isFinite(unitPrice * 100) || !Number.isFinite(lineTotal * 100)) throw new Error('The price is too large.');
  return { ...line, unitPrice, discountPercent, lineTotal };
}
