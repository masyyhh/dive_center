/** One format for monetary values across front-desk screens and reports. */
export const formatMoney = (amount: number | null | undefined, symbol = '$') => {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Preserve fractional-cent unit rates while bill totals use formatMoney. */
export const formatUnitPrice = (amount: number | null | undefined, symbol = '$') => {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
};
