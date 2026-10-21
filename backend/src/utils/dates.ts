/** Business dates are calendar dates in Maldives, independent of the server timezone. */
export const businessToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Maldives', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

export const isBusinessDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const isYearMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const isDateRange = (start: unknown, end: unknown): boolean =>
  isBusinessDate(start) && isBusinessDate(end) && start <= end;
