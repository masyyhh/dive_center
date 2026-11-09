// Missing attendance is not an exclusion; Basic and saved leave/absence exclude assigned credit.
export const isExcludedFromCredit = (status?: string): boolean =>
  Boolean(status && !['PRESENT', 'OFF', 'OFF_HALF'].includes(status.toUpperCase()));
