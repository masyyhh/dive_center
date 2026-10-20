import React, { useState, useEffect } from 'react';
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

export const ReportingView: React.FC = () => {
  const { activeProperty } = useProperty();
  const { user } = useAuth();

  const canManageLocks = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';

  const todayStr = new Date().toISOString().substring(0, 10);
  const currentYm = todayStr.substring(0, 7);

  // Filters
  const [startDate, setStartDate] = useState<string>(`${currentYm}-01`);
  const [endDate, setEndDate] = useState<string>(todayStr);

  // Independent export parameters (PDF Page 6: "Monthly report — pick a month independent of the dashboard range")
  const [exportDate, setExportDate] = useState<string>(todayStr);
  const [exportMonth, setExportMonth] = useState<string>(currentYm);

  const [report, setReport] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [recomputing, setRecomputing] = useState<boolean>(false);
  const [lockLoading, setLockLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchReport = async () => {
    if (!activeProperty) return;
    try {
      setLoading(true);
      const res = await apiFetch<DashboardReport>(
        `/reports/dashboard?propertyId=${activeProperty.id}&startDate=${startDate}&endDate=${endDate}`
      );
      setReport(res);
    } catch (err: any) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [activeProperty, startDate, endDate]);

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
      alert(err.message || 'Failed to recompute.');
    } finally {
      setRecomputing(false);
    }
  };

  // Toggle Month Lock / Freeze for Payroll (PDF Page 6)
  const handleToggleLock = async () => {
    if (!activeProperty || !canManageLocks) return;
    const yearMonth = startDate.substring(0, 7);
    const currentlyLocked = Boolean(report?.period.isLocked);

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
      setMessage(`Month ${yearMonth} is now ${!currentlyLocked ? 'frozen for payroll (Locked)' : 'unlocked'}.`);
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to update lock.');
    } finally {
      setLockLoading(false);
    }
  };

  // Daily XLSX Download (PDF Page 6)
  const handleDownloadDaily = () => {
    if (!activeProperty) return;
    downloadFile(
      `/reports/export/daily?propertyId=${activeProperty.id}&date=${exportDate}`,
      `Daily_Report_${exportDate}.xlsx`
    );
  };

  // Monthly XLSX Workbook Download (PDF Page 6)
  const handleDownloadMonthly = () => {
    if (!activeProperty) return;
    downloadFile(
      `/reports/export/monthly?propertyId=${activeProperty.id}&yearMonth=${exportMonth}`,
      `Monthly_Payroll_Workbook_${exportMonth}.xlsx`
    );
  };

  // Quick CSV Chart Exporter
  const downloadChartCsv = (chartName: string, headers: string[], rows: any[][]) => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${chartName}_${startDate}_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const currencySymbol = activeProperty?.currencySymbol || '$';
  const COLORS = ['#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];

  return (
    <div className="space-y-6">
      {/* Top Header & Controls */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <BarChart3 className="w-5 h-5 text-sky-500" />
                <span>Financial & Commission Reporting</span>
              </h1>

              {/* Locked Pill (PDF Page 6) */}
              {report?.period.isLocked ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center space-x-1">
                  <Lock className="w-3 h-3" />
                  <span>Frozen for Payroll (Locked)</span>
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                  <Unlock className="w-3 h-3" />
                  <span>Live (Unlocked)</span>
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Set dashboard date range at the top and figures follow it. Reconciles directly with bills.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Recompute Commission Button (PDF Page 6) */}
            <button
              onClick={handleRecompute}
              disabled={recomputing || report?.period.isLocked}
              title={report?.period.isLocked ? 'Recompute disabled while month is locked for payroll' : 'Forces recalculation of commission'}
              className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recomputing ? 'animate-spin' : ''}`} />
              <span>Recompute Commission</span>
            </button>

            {/* Lock / Unlock Month Toggle (For Admin / Manager) */}
            {canManageLocks && (
              <button
                onClick={handleToggleLock}
                disabled={lockLoading}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                  report?.period.isLocked
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {report?.period.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                <span>{report?.period.isLocked ? 'Unlock Month' : 'Lock Month for Payroll'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Date Range Picker */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-slate-500 dark:text-slate-400 font-semibold">Dashboard Range:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none"
            />
          </div>
        </div>

        {message && (
          <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-xs">
            {message}
          </div>
        )}
      </div>

      {/* Export Cards Section (PDF Page 6: Daily & Monthly independent downloads) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily Report Download */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
              <span>Daily Report (.xlsx)</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Pick a date to download the day's checks & commission
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="date"
              value={exportDate}
              onChange={(e) => setExportDate(e.target.value)}
              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            />
            <button
              onClick={handleDownloadDaily}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition flex items-center space-x-1 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        {/* Monthly Payroll Workbook Download */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
              <FileSpreadsheet className="w-4 h-4 text-sky-500" />
              <span>Monthly Workbook (.xlsx)</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Full payroll workbook: Summary, Bills, Attendance & Staff
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="month"
              value={exportMonth}
              onChange={(e) => setExportMonth(e.target.value)}
              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            />
            <button
              onClick={handleDownloadMonthly}
              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition flex items-center space-x-1 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Workbook</span>
            </button>
          </div>
        </div>
      </div>

      {/* Headline Numbers Grid (PDF Page 6: turnover, service charge, tax, bill count, average bill, total commission) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Turnover (Gross)
          </span>
          <div className="text-lg font-black text-slate-900 dark:text-white mt-1">
            {currencySymbol}{report?.headline.turnover.toFixed(2) || '0.00'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Service Charge
          </span>
          <div className="text-lg font-black text-slate-900 dark:text-white mt-1">
            {currencySymbol}{report?.headline.serviceCharge.toFixed(2) || '0.00'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Tax (16%)
          </span>
          <div className="text-lg font-black text-slate-900 dark:text-white mt-1">
            {currencySymbol}{report?.headline.tax.toFixed(2) || '0.00'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Bill Count
          </span>
          <div className="text-lg font-black text-slate-900 dark:text-white mt-1">
            {report?.headline.billCount || 0}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Average Bill
          </span>
          <div className="text-lg font-black text-slate-900 dark:text-white mt-1">
            {currencySymbol}{report?.headline.averageBill.toFixed(2) || '0.00'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm bg-gradient-to-tr from-sky-500/5 to-teal-500/5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
            Total Commission
          </span>
          <div className="text-lg font-black text-teal-600 dark:text-teal-400 mt-1">
            {currencySymbol}{report?.headline.totalCommission.toFixed(2) || '0.00'}
          </div>
        </div>
      </div>

      {/* Staff Commission Table (PDF Page 6 & 7: Course, Dive, Override, Tips, Personal) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Users className="w-5 h-5 text-teal-500" />
              <span>Staff Commission Breakdown</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Table CSV</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Course Pool</th>
                <th className="py-3 px-4">Dive Pool</th>
                <th className="py-3 px-4">BL Override (+10%)</th>
                <th className="py-3 px-4">Tips Share</th>
                <th className="py-3 px-4">Personal</th>
                <th className="py-3 px-4 font-black text-slate-900 dark:text-white">Total Pay</th>
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
                      {currencySymbol}{s.courseCommission.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {currencySymbol}{s.diveCommission.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {s.overrideCommission > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          {currencySymbol}{s.overrideCommission.toFixed(2)}
                        </span>
                      ) : (
                        <span>$0.00</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {currencySymbol}{s.tipsCommission.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {currencySymbol}{s.personalCommission.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono font-black text-teal-600 dark:text-teal-400 text-sm">
                      {currencySymbol}{s.totalCommission.toFixed(2)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No staff commission recorded for this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
              className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
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
                    formatter={(val: any) => [`${currencySymbol}${Number(val).toFixed(2)}`, 'Revenue']}
                  />
                  <Bar dataKey="amount" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">No data</div>
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
              className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
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
                    formatter={(val: any) => [`${currencySymbol}${Number(val).toFixed(2)}`, 'Revenue']}
                  />
                  <Bar dataKey="amount" fill="#14b8a6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">No data</div>
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
              className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
            >
              <Download className="w-3 h-3" />
              <span>CSV</span>
            </button>
          </div>
          <div className="space-y-2">
            {report?.charts.topItems && report.charts.topItems.length > 0 ? (
              report.charts.topItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="w-5 font-bold text-slate-400">#{idx + 1}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{item.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {currencySymbol}{item.revenue.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-2">({item.count} sold)</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">No items recorded</div>
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
              className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
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
                    formatter={(val: any) => [`${currencySymbol}${Number(val).toFixed(2)}`, 'Revenue']}
                  />
                  <Bar dataKey="amount" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">No data</div>
            )}
          </div>
        </div>
      </div>

      {/* "Who Did What" Personal Commission Table (PDF Page 6 & 7) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              "Who Did What" Personal Commission Detail
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Check #</th>
                <th className="py-3 px-4">Room</th>
                <th className="py-3 px-4">Guest</th>
                <th className="py-3 px-4">Item / Activity</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4 font-black text-right text-slate-900 dark:text-white">Credited Amount</th>
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
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                        {p.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{p.staffName}</td>
                    <td className="py-3 px-4 font-mono font-black text-right text-emerald-600 dark:text-emerald-400">
                      {currencySymbol}{p.amount.toFixed(2)}
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
    </div>
  );
};
