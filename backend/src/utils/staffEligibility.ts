// Missing attendance is not an exclusion; saved leave/absence statuses are.
export const isExcludedFromCredit = (status?: string): boolean =>
  Boolean(status && !['PRESENT', 'OFF', 'OFF_HALF'].includes(status.toUpperCase()));
