type DiscountLine = { quantity: number; unitPrice: number; discountPercent: number };
/** Apply a checkout percentage after existing line discounts, before charges and tax. */
export function applyCheckoutDiscount<T extends DiscountLine>(lines: T[], percent = 0) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new RangeError('Checkout discount must be between 0 and 100%.');
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity * (1 - line.discountPercent / 100), 0);
  const fraction = percent / 100;
  return {
    amount: subtotal * fraction, subtotal,
    lines: lines.map(line => {
      // Preserve untouched line percentages exactly, including older bill drafts.
      const discountPercent = percent === 0 ? line.discountPercent : Math.min(100, Math.max(0, line.discountPercent + (100 - line.discountPercent) * fraction));
      return { ...line, discountPercent, lineTotal: line.unitPrice * line.quantity * (1 - discountPercent / 100) };
    }),
  };
}
