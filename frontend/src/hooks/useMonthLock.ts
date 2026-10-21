import { useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { DashboardReport } from '../types';
import { monthRange } from '../utils/dates';

/** Read payroll status before offering edits that the API would reject. */
export const useMonthLock = (propertyId: string | undefined, yearMonth: string) => {
  const [state, setState] = useState<{ key: string; locked: boolean | null; error: string }>({ key: '', locked: null, error: '' });
  const [version, setVersion] = useState(0);
  const key = `${propertyId}:${yearMonth}`;
  useEffect(() => {
    const range = monthRange(yearMonth);
    if (!propertyId || !range) return;
    const controller = new AbortController();
    setState({ key, locked: null, error: '' });
    apiFetch<DashboardReport>(`/reports/dashboard?propertyId=${propertyId}&startDate=${range.start}&endDate=${range.end}`, { signal: controller.signal })
      .then(report => { if (!controller.signal.aborted) setState({ key, locked: report.period.isLocked, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setState({ key, locked: null, error: error instanceof Error ? error.message : 'Could not check payroll status.' }); });
    return () => controller.abort();
  }, [key, propertyId, yearMonth, version]);
  return { locked: state.key === key ? state.locked : null, error: state.key === key ? state.error : '', retry: () => setVersion(value => value + 1) };
};
