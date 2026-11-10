/** Business dates follow the centre's Maldives timezone, independent of the device. */
export const businessToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Indian/Maldives', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export const isBusinessDate = (value: string | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const displayDate = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  isBusinessDate(date) ? new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : '—';

export const monthRange = (yearMonth: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return null;
  const start = `${yearMonth}-01`;
  const last = new Date(`${start}T12:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  return { start, end: last.toISOString().slice(0, 10) };
};

/** Monday through Sunday, calculated as calendar dates without device timezone shifts. */
export const businessWeek = (date: string) => {
  if (!isBusinessDate(date)) return null;
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const start = monday.toISOString().slice(0, 10);
  const end = sunday.toISOString().slice(0, 10);
  return isBusinessDate(start) && isBusinessDate(end) ? { start, end } : null;
};
