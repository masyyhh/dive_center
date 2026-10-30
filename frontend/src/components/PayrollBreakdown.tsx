import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { apiFetch } from '../services/api';
import { PayrollBreakdownData } from '../types';
import { formatMoney } from '../utils/format';
import { displayDate } from '../utils/dates';
const channelNames = { COURSE_POOL: 'Course pool', DIVE_POOL: 'Dive pool', OVERRIDE: 'Base-leader override', TIPS: 'Tips', PERSONAL: 'Employee payment' };

export const PayrollBreakdown: React.FC<{ propertyId: string; staffId: string; startDate: string; endDate: string; currencySymbol: string; onClose: () => void }> = ({ propertyId, staffId, startDate, endDate, currencySymbol, onClose }) => {
  const [data, setData] = useState<PayrollBreakdownData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    const query = new URLSearchParams({ propertyId, staffId, startDate, endDate });
    apiFetch<PayrollBreakdownData>(`/reports/commission-breakdown?${query}`)
      .then(result => { if (!cancelled) setData(result); })
      .catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : 'Could not load the breakdown.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [propertyId, staffId, startDate, endDate, attempt]);
  const money = (amount: number) => formatMoney(amount, currencySymbol);
  const preciseMoney = (amount: number) => `${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  return <Modal label="Why this payroll amount?" onClose={onClose} error={error}>
    <div className="surface payroll-breakdown p-5 space-y-4">
      <div className="flex justify-between gap-4 items-start"><div><h2 className="text-xl font-bold">Why this amount?</h2><p>{data?.staff.staffName || 'Employee payroll'} · {displayDate(startDate)}–{displayDate(endDate)}</p></div><button type="button" className="secondary-button" onClick={onClose}>Close</button></div>
      {loading && <p role="status">Loading bill and service calculations…</p>}
      {error && <button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      {data && <>
        <div className="payroll-breakdown-total"><span>Total commission</span><strong>{money(data.staff.totalCommission)}</strong></div>
        <p className="text-xs text-slate-500">Pool shares use eligible staff and attendance on each business date. Certifications are not paid to staff. Saved pool contributions preserve locked payroll rules.</p>
        <ol className="payroll-breakdown-list">{data.details.map(detail => <li key={detail.id}>
          <div className="flex flex-wrap justify-between gap-2"><strong>{detail.itemName}</strong><strong>{money(detail.amount)}</strong></div>
          <div className="payroll-breakdown-meta">Check #{detail.checkNumber} · {displayDate(detail.businessDate)} · {channelNames[detail.kind]}</div>
          <p>{detail.kind === 'PERSONAL' ? `${preciseMoney(detail.unitRate ?? 0)} × ${detail.quantity} service unit(s)` : `${preciseMoney(detail.basisAmount)}${detail.factor !== 1 ? ` × ${detail.factor * 100}%` : ''} ÷ ${detail.recipientCount} eligible employee${detail.recipientCount === 1 ? '' : 's'}`} = {money(detail.amount)}</p>
          <small>{detail.explanation}</small>
        </li>)}</ol>
        {!data.details.length && <p>No payable bill or service entries for this employee in the selected period.</p>}
        {data.roundingAdjustment !== 0 && <div className="flex justify-between text-sm"><span>Rounding adjustment</span><strong>{money(data.roundingAdjustment)}</strong></div>}
        <p className="text-xs text-slate-500">Amounts are summed before the final payroll total is rounded. Any difference from rounding individual entries is shown above.</p>
      </>}
    </div>
  </Modal>;
};
