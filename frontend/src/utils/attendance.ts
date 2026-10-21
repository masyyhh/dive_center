import { AttendanceItem } from '../types';
export const attendanceSnapshot = (records: AttendanceItem[]) => JSON.stringify(records.map(record => ({ id: record.staffMemberId, status: record.status, note: record.note || '' })).sort((a, b) => a.id.localeCompare(b.id)));
export const attendanceDayState = (info: { markedCount: number; expectedCount: number } | undefined, date: string, today: string) => {
  if (!info) return { label: 'Unavailable', short: '—', tone: 'neutral' };
  if (info.expectedCount === 0) return { label: 'No staff', short: 'No staff', tone: 'neutral' };
  if (info.markedCount >= info.expectedCount) return { label: 'Complete', short: 'Done', tone: 'complete' };
  if (info.markedCount > 0) return { label: 'Partial', short: 'Partial', tone: 'partial' };
  if (date < today) return { label: 'Missing', short: 'Missing', tone: 'missing' };
  return { label: 'Not recorded', short: 'Not set', tone: 'neutral' };
};
