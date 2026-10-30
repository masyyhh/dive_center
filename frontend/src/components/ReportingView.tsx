import { serializeCsv } from '../utils/csv';
import { formatMoney } from '../utils/format';
import { Modal } from './Modal';
import { PayrollBreakdown } from './PayrollBreakdown';
import { businessToday } from '../utils/dates';
import React, { useState, useEffect, useRef } from 'react';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, downloadFile } from '../services/api';
import { DashboardReport, StaffCommissionResult, PersonalCommissionDetail } from '../types';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  BarChart3,
  Calendar,
  Download,
  RefreshCw,
  Lock,
  Unlock,
  DollarSign,
  Receipt,
  Users,
  Percent,
  TrendingUp,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';

export const ReportingView: React.FC<{ section?: string; onSectionChange: (section: string) => void }> = ({ section, onSectionChange }) => {
  const reportTab = section === 'commissions' || section === 'exports' ? section : 'performance';
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
  const [startDate, setStartDate] = useState<string>(`${currentYm}-01`);
  const [endDate, setEndDate] = useState<string>(todayStr);

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
  const downloadChartCsv = (chartName: string, headers: string[], rows: any[][]) => {
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
  const COLORS = ['#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];

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

            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Review performance, commission shares, and payroll for your selected period.
            </p>
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
      {reportTab === 'performance' && <section id="panel-performance" role="tabpanel" aria-labelledby="tab-performance" className="space-y-6">
      {/* Headline Numbers Grid (PDF Page 6: turnover, service charge, tax, bill count, average bill, total commission) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Turnover (Gross)
          </span>
          <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {formatMoney(report?.headline.turnover, currencySymbol)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Service Charge
          </span>
          <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {formatMoney(report?.headline.serviceCharge, currencySymbol)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Tax
          </span>
          <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {formatMoney(report?.headline.tax, currencySymbol)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Bill Count
          </span>
          <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {report?.headline.billCount || 0}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Average Bill
          </span>
          <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
            {formatMoney(report?.headline.averageBill, currencySymbol)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm bg-gradient-to-tr from-sky-500/5 to-teal-500/5">
          <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
            Total Commission
          </span>
          <div className="text-lg font-bold text-teal-600 dark:text-teal-400 mt-1">
            {formatMoney(report?.headline.totalCommission, currencySymbol)}
          </div>
        </div>
      </div>

      {/* Analytics Charts Grid (PDF Page 6: Category, Nationality, Top Items, Weekday) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Category */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Revenue by Category
            </h4>
            <button
              onClick={() =>
                downloadChartCsv(
                  'Category_Revenue',
                  ['Category', 'Revenue'],
                  (report?.charts.categoryRevenue || []).map((c) => [c.category, c.amount])
                )
              }
              className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
            >
              <Download className="w-3 h-3" />
              <span>CSV</span>
            </button>
          </div>
          <div className="h-64">
            {report?.charts.categoryRevenue && report.charts.categoryRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.charts.categoryRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                  <XAxis dataKey="category" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${currencySymbol}${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem', color: '#fff', fontSize: '12px' }}
                    formatter={(val: any) => [formatMoney(Number(val), currencySymbol), 'Revenue']}
                  />
                  <Bar dataKey="amount" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">No saved bills in this period</div>
            )}
          </div>
        </div>

        {/* Revenue by Nationality */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Revenue by Guest Nationality
            </h4>
            <button
              onClick={() =>
                downloadChartCsv(
                  'Nationality_Revenue',
                  ['Nationality', 'Revenue'],
                  (report?.charts.nationalityRevenue || []).map((n) => [n.nationality, n.amount])
                )
              }
              className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
            >
              <Download className="w-3 h-3" />
              <span>CSV</span>
            </button>
          </div>
          <div className="h-64">
            {report?.charts.nationalityRevenue && report.charts.nationalityRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.charts.nationalityRevenue} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                  <XAxis type="number" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${currencySymbol}${v}`} />
                  <YAxis dataKey="nationality" type="category" stroke="#94a3b8" fontSize={11} width={80} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem', color: '#fff', fontSize: '12px' }}
                    formatter={(val: any) => [formatMoney(Number(val), currencySymbol), 'Revenue']}
                  />
                  <Bar dataKey="amount" fill="#14b8a6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">No saved bills in this period</div>
            )}
          </div>
        </div>

        {/* Top Items by Revenue */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Top Items & Activities
            </h4>
            <button
              onClick={() =>
                downloadChartCsv(
                  'Top_Items',
                  ['Item', 'Count', 'Revenue'],
                  (report?.charts.topItems || []).map((t) => [t.name, t.count, t.revenue])
                )
              }
              className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
            >
              <Download className="w-3 h-3" />
              <span>CSV</span>
            </button>
          </div>
          <div className="space-y-2">
            {report?.charts.topItems && report.charts.topItems.length > 0 ? (
              report.charts.topItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 text-sm">
                  <div className="flex items-center space-x-2">
                    <span className="w-5 font-bold text-slate-400">#{idx + 1}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{item.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {formatMoney(item.revenue, currencySymbol)}
                    </span>
                    <span className="text-xs text-slate-400 ml-2">({item.count} sold)</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-sm text-slate-400">No items recorded</div>
            )}
          </div>
        </div>

        {/* Revenue by Weekday */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Revenue by Day of Week
            </h4>
            <button
              onClick={() =>
                downloadChartCsv(
                  'Weekday_Revenue',
                  ['Day', 'Revenue'],
                  (report?.charts.weekdayRevenue || []).map((w) => [w.day, w.amount])
                )
              }
              className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
            >
              <Download className="w-3 h-3" />
              <span>CSV</span>
            </button>
          </div>
          <div className="h-64">
            {report?.charts.weekdayRevenue && report.charts.weekdayRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.charts.weekdayRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                  <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickFormatter={(d) => d.slice(0, 3)} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${currencySymbol}${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem', color: '#fff', fontSize: '12px' }}
                    formatter={(val: any) => [formatMoney(Number(val), currencySymbol), 'Revenue']}
                  />
                  <Bar dataKey="amount" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">No saved bills in this period</div>
            )}
          </div>
        </div>
      </div>

      </section>}
      {reportTab === 'commissions' && <section id="panel-commissions" role="tabpanel" aria-labelledby="tab-commissions" className="space-y-6"><div className="section-toolbar"><p>Commission shares for the selected report period.</p>
            {/* Recompute Commission Button (PDF Page 6) */}
            <button
              onClick={handleRecompute}
              disabled={loading || !report || recomputing || report?.period.isLocked}
              title={report?.period.isLocked ? 'Recompute disabled while month is locked for payroll' : 'Forces recalculation of commission'}
              className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recomputing ? 'animate-spin' : ''}`} />
              <span>Recompute Commission</span>
            </button>

</div>
      {/* Staff Commission Table (PDF Page 6 & 7: Course, Dive, Override, Tips, Personal) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Users className="w-5 h-5 text-teal-500" />
              <span>Staff Commission Breakdown</span>
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Calculated across 5 channels: Course Pool, Dive Pool, Base Leader Override, Tips, and Personal.
            </p>
          </div>

          <button
            onClick={() =>
              downloadChartCsv(
                'Staff_Commission',
                ['Staff Name', 'Role', 'Course Pool', 'Dive Pool', 'Override', 'Tips', 'Personal', 'Total'],
                (report?.staffCommissions || []).map((s) => [
                  s.staffName,
                  s.roleTitle,
                  s.courseCommission,
                  s.diveCommission,
                  s.overrideCommission,
                  s.tipsCommission,
                  s.personalCommission,
                  s.totalCommission,
                ])
              )
            }
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-sm font-semibold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Table CSV</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Course Pool</th>
                <th className="py-3 px-4">Dive Pool</th>
                <th className="py-3 px-4">BL Override (+10%)</th>
                <th className="py-3 px-4">Tips Share</th>
                <th className="py-3 px-4">Personal</th>
                <th className="py-3 px-4 font-bold text-slate-900 dark:text-white">Total commission</th>
                <th className="py-3 px-4">Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report?.staffCommissions && report.staffCommissions.length > 0 ? (
                report.staffCommissions.map((s) => (
                  <tr key={s.staffId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      {s.staffName}
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {s.roleTitle}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatMoney(s.courseCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatMoney(s.diveCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {s.overrideCommission > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          {formatMoney(s.overrideCommission, currencySymbol)}
                        </span>
                      ) : (
                        <span>$0.00</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatMoney(s.tipsCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatMoney(s.personalCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-teal-600 dark:text-teal-400 text-sm">
                      {formatMoney(s.totalCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4"><button type="button" className="text-button" onClick={() => setBreakdownStaffId(s.staffId)} aria-label={`Why this amount for ${s.staffName}?`}>Why this amount?</button></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    No staff commission recorded for this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* "Who Did What" Personal Commission Table (PDF Page 6 & 7) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              "Who Did What" Personal Commission Detail
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Specific line-by-line credit log (Seller, Guide, Instructor, Photographer, Videographer)
            </p>
          </div>

          <button
            onClick={() =>
              downloadChartCsv(
                'Personal_Commission_Detail',
                ['Date', 'Check', 'Room', 'Guest', 'Item', 'Role', 'Staff', 'Amount'],
                (report?.personalDetails || []).map((p) => [
                  p.businessDate,
                  p.checkNumber,
                  p.roomNumber,
                  p.guestName,
                  p.itemName,
                  p.role,
                  p.staffName,
                  p.amount,
                ])
              )
            }
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-sm font-semibold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Check #</th>
                <th className="py-3 px-4">Room</th>
                <th className="py-3 px-4">Guest</th>
                <th className="py-3 px-4">Item / Activity</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4 font-bold text-right text-slate-900 dark:text-white">Credited Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report?.personalDetails && report.personalDetails.length > 0 ? (
                report.personalDetails.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{p.businessDate}</td>
                    <td className="py-3 px-4 font-mono font-bold text-sky-600 dark:text-sky-400">#{p.checkNumber}</td>
                    <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">Room {p.roomNumber}</td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">{p.guestName}</td>
                    <td className="py-3 px-4 text-slate-800 dark:text-slate-200">{p.itemName}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                        {p.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{p.staffName}</td>
                    <td className="py-3 px-4 font-mono font-bold text-right text-emerald-600 dark:text-emerald-400">
                      {formatMoney(p.amount, currencySymbol)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No personal commission lines recorded in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </section>}
      {reportTab === 'exports' && <section id="panel-exports" role="tabpanel" aria-labelledby="tab-exports" className="space-y-6">
      {/* Export Cards Section (PDF Page 6: Daily & Monthly independent downloads) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily Report Download */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm export-card flex flex-col items-stretch justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
              <span>Daily Report (.xlsx)</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Pick a date to download the day's checks & commission
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="date"
              aria-label="Daily report date"
              value={exportDate}
              onChange={(e) => setExportDate(e.target.value)}
              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white"
            />
            <button
              onClick={handleDownloadDaily}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition flex items-center space-x-1 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        {/* Monthly Payroll Workbook Download */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm export-card flex flex-col items-stretch justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
              <FileSpreadsheet className="w-4 h-4 text-sky-500" />
              <span>Monthly Workbook (.xlsx)</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Full payroll workbook: Summary, Bills, Attendance & Staff
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="month"
              aria-label="Payroll workbook month"
              value={exportMonth}
              disabled={lockLoading}
              onChange={(e) => setExportMonth(e.target.value)}
              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white"
            />
            <button
              onClick={handleDownloadMonthly}
              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm transition flex items-center space-x-1 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Workbook</span>
            </button>
          </div>
        </div>
      </div>

        <div className="surface payroll-panel"><div><span className="eyebrow">PAYROLL CONTROL</span><h2>Month lock</h2><p>Lock a month after reviewing bills and attendance. A locked month prevents changes to its bills and attendance.</p></div><div className="payroll-control-row"><label htmlFor="payroll-month">Payroll month</label><input id="payroll-month" type="month" value={exportMonth} disabled={lockLoading} onChange={event => setExportMonth(event.target.value)} /><span className={`status-badge ${payrollLocked ? 'status-rebated' : 'status-active'}`}>{payrollLoading ? 'Checking…' : payrollLocked === null ? 'Unavailable' : payrollLocked ? 'Locked' : 'Open'}</span>{canManageLocks && <button className="secondary-button" disabled={payrollLoading || payrollLocked === null || lockLoading} onClick={() => setConfirmLock(true)}>{payrollLocked ? 'Unlock month' : 'Lock month'}</button>}</div>{!canManageLocks && <p>Your property manager controls payroll locks.</p>}{payrollError && <div className="notice notice-error" role="alert"><span>{payrollError}</span><button onClick={() => setPayrollVersion(value => value + 1)}>Retry</button></div>}</div>
      </section>}
      {breakdownStaffId && activeProperty && <PayrollBreakdown propertyId={activeProperty.id} staffId={breakdownStaffId} startDate={startDate} endDate={endDate} currencySymbol={currencySymbol} onClose={() => setBreakdownStaffId(null)} />}
      {confirmLock && <Modal label={payrollLocked ? 'Unlock payroll month?' : 'Lock payroll month?'} busy={lockLoading} onClose={() => setConfirmLock(false)} error={errorMsg}><div className="surface guard-dialog"><h2>{payrollLocked ? 'Unlock' : 'Lock'} {exportMonth}?</h2><p>{payrollLocked ? 'Bills and attendance in this month will become editable again.' : 'Bills and attendance in this month will be frozen for payroll. Confirm your team has finished reviewing them.'}</p><div className="dialog-actions"><button className="secondary-button" disabled={lockLoading} onClick={() => setConfirmLock(false)}>Cancel</button><button className="primary-button" disabled={lockLoading} onClick={handleToggleLock}>{lockLoading ? 'Updating…' : payrollLocked ? 'Unlock month' : 'Lock month'}</button></div></div></Modal>}
    </div>
  );
};
