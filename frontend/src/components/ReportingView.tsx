import { investigationPeriod } from '../utils/dashboardNavigation';
import { serializeCsv } from '../utils/csv';
import { formatMoney } from '../utils/format';
import { Modal } from './Modal';
import { PayrollBreakdown } from './PayrollBreakdown';
import { businessToday } from '../utils/dates';
import React, { useState, useEffect, useRef } from 'react';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, downloadFile } from '../services/api';
import { DashboardReport } from '../types';
import { BarChart3, Lock, Unlock } from 'lucide-react';
import { PerformancePanel } from './reporting/PerformancePanel';
import { CommissionPanel } from './reporting/CommissionPanel';
import { ExportPanel } from './reporting/ExportPanel';
import type { DownloadChartCsv } from './reporting/types';

export const ReportingView: React.FC<{ section?: string; onSectionChange: (section: string) => void }> = ({ section, onSectionChange }) => {
  const tab = section?.split('?')[0];
  const reportTab = tab === 'commissions' || tab === 'exports' ? tab : 'performance';
  const initialPeriod = investigationPeriod(section);
  const [payrollLocked, setPayrollLocked] = useState<boolean | null>(null);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollError, setPayrollError] = useState('');
  const [confirmLock, setConfirmLock] = useState(false);
  const [payrollVersion, setPayrollVersion] = useState(0);
  const { activeProperty } = useProperty();
  const { user } = useAuth();

  const canManageLocks = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';

  const todayStr = businessToday();
  const currentYm = todayStr.substring(0, 7);

  // Filters
  const [startDate, setStartDate] = useState<string>(initialPeriod?.startDate || `${currentYm}-01`);
  const [endDate, setEndDate] = useState<string>(initialPeriod?.endDate || todayStr);

  useEffect(() => {
    const period = investigationPeriod(section);
    if (period) { setStartDate(period.startDate); setEndDate(period.endDate); }
  }, [section]);

  // Independent export parameters (PDF Page 6: "Monthly report — pick a month independent of the dashboard range")
  const [exportDate, setExportDate] = useState<string>(todayStr);
  const [exportMonth, setExportMonth] = useState<string>(currentYm);

  const reportRequest = useRef(0);
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [recomputing, setRecomputing] = useState<boolean>(false);
  const [lockLoading, setLockLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [breakdownStaffId, setBreakdownStaffId] = useState<string | null>(null);
  useEffect(() => setBreakdownStaffId(null), [activeProperty?.id, startDate, endDate]);

  const fetchReport = async () => {
    if (!activeProperty) return;
    const request = ++reportRequest.current;
    if (!startDate || !endDate || startDate > endDate) { setErrorMsg('Choose a valid report period. The start date must be on or before the end date.'); setLoading(false); setReport(null); return; }
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await apiFetch<DashboardReport>(
        `/reports/dashboard?propertyId=${activeProperty.id}&startDate=${startDate}&endDate=${endDate}`
      );
      if (request !== reportRequest.current) return;
      setReport(res);
    } catch (err: any) {
      if (request !== reportRequest.current) return;
      setReport(null);
      setErrorMsg(err.message || 'Unable to load this report.');
    } finally {
      if (request === reportRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    return () => { reportRequest.current++; };
  }, [activeProperty, startDate, endDate]);

  useEffect(() => {
    if (reportTab !== 'exports' || !activeProperty) return;
    let cancelled = false;
    setPayrollLocked(null); setPayrollLoading(true); setPayrollError('');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(exportMonth)) { setPayrollLoading(false); return; }
    const [year, month] = exportMonth.split('-').map(Number);
    const last = new Date(year, month, 0).getDate();
    apiFetch<DashboardReport>(`/reports/dashboard?propertyId=${activeProperty.id}&startDate=${exportMonth}-01&endDate=${exportMonth}-${last}`)
      .then(result => { if (!cancelled) setPayrollLocked(result.period.isLocked); })
      .catch(err => { if (!cancelled) setPayrollError(err instanceof Error ? err.message : 'Unable to load payroll status.'); })
      .finally(() => { if (!cancelled) setPayrollLoading(false); });
    return () => { cancelled = true; };
  }, [reportTab, activeProperty, exportMonth, payrollVersion]);
  // Recompute Commission (PDF Page 6)
  const handleRecompute = async () => {
    if (!activeProperty || report?.period.isLocked) return;
    try {
      setRecomputing(true);
      await apiFetch('/reports/recompute', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: activeProperty.id,
          startDate,
          endDate,
        }),
      });
      fetchReport();
      setMessage('Commission figures recomputed successfully.');
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to recompute.');
    } finally {
      setRecomputing(false);
    }
  };

  // Toggle Month Lock / Freeze for Payroll (PDF Page 6)
  const handleToggleLock = async () => {
    if (!activeProperty || !canManageLocks || payrollLocked === null) return;
    const yearMonth = exportMonth;
    const currentlyLocked = payrollLocked;

    try {
      setLockLoading(true);
      await apiFetch('/reports/month-lock', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: activeProperty.id,
          yearMonth,
          lock: !currentlyLocked,
        }),
      });
      fetchReport();
      setConfirmLock(false);
      setPayrollVersion(value => value + 1);
      setMessage(`Month ${yearMonth} is now ${!currentlyLocked ? 'frozen for payroll (Locked)' : 'unlocked'}.`);
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update lock.');
    } finally {
      setLockLoading(false);
    }
  };

  // Daily XLSX Download (PDF Page 6)
  const handleDownloadDaily = async () => {
    if (!activeProperty) return;
    try { await downloadFile(
      `/reports/export/daily?propertyId=${activeProperty.id}&date=${exportDate}`,
      `Daily_Report_${exportDate}.xlsx`
    ); } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Could not download the daily report.'); }
  };

  // Monthly XLSX Workbook Download (PDF Page 6)
  const handleDownloadMonthly = async () => {
    if (!activeProperty) return;
    try { await downloadFile(
      `/reports/export/monthly?propertyId=${activeProperty.id}&yearMonth=${exportMonth}`,
      `Monthly_Payroll_Workbook_${exportMonth}.xlsx`
    ); } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Could not download the monthly workbook.'); }
  };

  // Quick CSV Chart Exporter
  const downloadChartCsv: DownloadChartCsv = (chartName, headers, rows) => {
    const csvContent = serializeCsv([headers, ...rows]);
    const encodedUri = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${chartName}_${startDate}_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(encodedUri), 1000);
  };

  const currencySymbol = activeProperty?.currencySymbol || '$';

  return (
    <div className="space-y-6" aria-busy={loading}>
      {loading && <p role="status" className="text-sm text-slate-500">Updating your report…</p>}
      {errorMsg && <div role="alert" className="notice notice-error"><span>{errorMsg}</span><button onClick={() => { setErrorMsg(null); fetchReport(); }}>Try again</button></div>}
      {/* Top Header & Controls */}
      <div className="feature-controls bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2 items-center">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <BarChart3 className="w-5 h-5 text-sky-500" />
                <span>Reports & payroll</span>
              </h1>

              {/* Locked Pill (PDF Page 6) */}
              {report?.period.isLocked ? (
                <span className="px-2.5 py-0.5 rounded-full text-sm font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center space-x-1">
                  <Lock className="w-3 h-3" />
                  <span>Includes locked payroll month</span>
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-sm font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                  <Unlock className="w-3 h-3" />
                  <span>{loading ? 'Checking period…' : report ? 'Open period' : 'Status unavailable'}</span>
                </span>
              )}
            </div>


          </div>


        </div>

        {/* Date Range Picker */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-sm">
          <div className="report-date-range">
            <span className="text-slate-500 dark:text-slate-400 font-semibold">Report period:</span>
            <input
              type="date"
              aria-label="Report start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              aria-label="Report end date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none"
            />
          </div>
        </div>

        {message && (
          <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-sm">
            {message}
          </div>
        )}
      </div>

      <div className="report-tabs" role="tablist" aria-label="Report sections">{([['performance', 'Performance'], ['commissions', 'Staff commissions'], ['exports', 'Exports & payroll']] as const).map(([id, label]) => <button key={id} role="tab" id={`tab-${id}`} aria-selected={reportTab === id} aria-controls={`panel-${id}`} tabIndex={reportTab === id ? 0 : -1} onClick={() => onSectionChange(id)} onKeyDown={event => { const ids = ['performance', 'commissions', 'exports']; const index = ids.indexOf(id); const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1; if (next >= 0) { event.preventDefault(); onSectionChange(ids[next]); requestAnimationFrame(() => document.getElementById(`tab-${ids[next]}`)?.focus()); } }}>{label}</button>)}</div>
      <div className="surface p-4 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-bold">Certifications pool</h3><p className="text-sm text-slate-500">Tracked separately. No staff commission or base-leader override is paid from this pool.</p></div>
        <strong>{formatMoney(report?.headline.certificationPoolTotal ?? 0, currencySymbol)}</strong>
      </div>
      {reportTab === 'performance' && <PerformancePanel report={report} currencySymbol={currencySymbol} downloadChartCsv={downloadChartCsv} />}
      {reportTab === 'commissions' && <CommissionPanel report={report} currencySymbol={currencySymbol} downloadChartCsv={downloadChartCsv} loading={loading} recomputing={recomputing} handleRecompute={handleRecompute} setBreakdownStaffId={setBreakdownStaffId} />}
      {reportTab === 'exports' && <ExportPanel exportDate={exportDate} setExportDate={setExportDate} exportMonth={exportMonth} setExportMonth={setExportMonth} lockLoading={lockLoading} payrollLoading={payrollLoading} payrollLocked={payrollLocked} payrollError={payrollError} canManageLocks={canManageLocks} handleDownloadDaily={handleDownloadDaily} handleDownloadMonthly={handleDownloadMonthly} onConfirmLock={() => setConfirmLock(true)} onRetryPayroll={() => setPayrollVersion(value => value + 1)} />}
      {breakdownStaffId && activeProperty && <PayrollBreakdown propertyId={activeProperty.id} staffId={breakdownStaffId} startDate={startDate} endDate={endDate} currencySymbol={currencySymbol} onClose={() => setBreakdownStaffId(null)} />}
      {confirmLock && <Modal label={payrollLocked ? 'Unlock payroll month?' : 'Lock payroll month?'} busy={lockLoading} onClose={() => setConfirmLock(false)} error={errorMsg}><div className="surface guard-dialog"><h2>{payrollLocked ? 'Unlock' : 'Lock'} {exportMonth}?</h2><p>{payrollLocked ? 'Bills and attendance in this month will become editable again.' : 'Bills and attendance in this month will be frozen for payroll. Confirm your team has finished reviewing them.'}</p><div className="dialog-actions"><button className="secondary-button" disabled={lockLoading} onClick={() => setConfirmLock(false)}>Cancel</button><button className="primary-button" disabled={lockLoading} onClick={handleToggleLock}>{lockLoading ? 'Updating…' : payrollLocked ? 'Unlock month' : 'Lock month'}</button></div></div></Modal>}
    </div>
  );
};
