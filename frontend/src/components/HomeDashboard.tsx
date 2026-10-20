import React, { useState, useEffect } from 'react';
import { useProperty } from '../context/PropertyContext';
import { apiFetch } from '../services/api';
import { DashboardReport, Bill } from '../types';
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
} from 'recharts';
import {
  DollarSign,
  Receipt,
  TrendingUp,
  Percent,
  Calendar,
  Layers,
  ArrowRight,
  BarChart2,
  LineChart as LineChartIcon,
} from 'lucide-react';

interface HomeDashboardProps {
  onNavigate: (tab: 'new-bill' | 'bills') => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({ onNavigate }) => {
  const { activeProperty } = useProperty();
  const [chartMode, setChartMode] = useState<'line' | 'bar'>('line');
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<DashboardReport | null>(null);
  const [todayBills, setTodayBills] = useState<Bill[]>([]);

  // Default to current date and month
  const todayStr = new Date().toISOString().substring(0, 10);
  const currentYm = todayStr.substring(0, 7);
  const startOfMonth = `${currentYm}-01`;
  const endOfMonth = `${currentYm}-31`;

  const loadDashboard = async () => {
    if (!activeProperty) return;
    try {
      setLoading(true);
      const [reportRes, billsRes] = await Promise.all([
        apiFetch<DashboardReport>(
          `/reports/dashboard?propertyId=${activeProperty.id}&startDate=${startOfMonth}&endDate=${endOfMonth}`
        ),
        apiFetch<{ bills: Bill[] }>(
          `/bills?propertyId=${activeProperty.id}&startDate=${todayStr}&endDate=${todayStr}`
        ),
      ]);

      setData(reportRes);
      setTodayBills(billsRes.bills);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [activeProperty]);

  // Today's revenue calculation
  const todayRevenue = todayBills
    .filter((b) => b.status === 'ACTIVE')
    .reduce((acc, b) => acc + b.netAmount, 0);

  const todayGross = todayBills
    .filter((b) => b.status === 'ACTIVE')
    .reduce((acc, b) => acc + b.grossAmount, 0);

  const currencySymbol = activeProperty?.currencySymbol || '$';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
            <Calendar className="w-3.5 h-3.5" />
            <span>Today's Business Date: {todayStr}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
            {activeProperty?.name} Dashboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time daily operations, turnover analytics, and running totals.
          </p>
        </div>

        <button
          onClick={() => onNavigate('new-bill')}
          className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-teal-500 text-white font-semibold text-sm shadow-md shadow-sky-500/20 hover:from-sky-600 hover:to-teal-600 transition"
        >
          <span>Write New Bill</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Revenue */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Today's Net Revenue
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {currencySymbol}{todayRevenue.toFixed(2)}
            </span>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center space-x-1">
              <span>Gross: {currencySymbol}{todayGross.toFixed(2)}</span>
              <span>•</span>
              <span>{todayBills.filter((b) => b.status === 'ACTIVE').length} active bills today</span>
            </div>
          </div>
        </div>

        {/* Month-to-date Turnover */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Month Turnover (Gross)
            </span>
            <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {currencySymbol}{data?.headline.turnover.toFixed(2) || '0.00'}
            </span>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Running total for {currentYm}
            </div>
          </div>
        </div>

        {/* Service Charge & Tax */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Service Charge & Tax
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {currencySymbol}
              {((data?.headline.serviceCharge || 0) + (data?.headline.tax || 0)).toFixed(2)}
            </span>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex justify-between">
              <span>SC (10%): {currencySymbol}{data?.headline.serviceCharge.toFixed(2) || '0.00'}</span>
              <span>Tax (16%): {currencySymbol}{data?.headline.tax.toFixed(2) || '0.00'}</span>
            </div>
          </div>
        </div>

        {/* Average Bill Check */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Average Bill
            </span>
            <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {currencySymbol}{data?.headline.averageBill.toFixed(2) || '0.00'}
            </span>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Across {data?.headline.billCount || 0} active bills this month
            </div>
          </div>
        </div>
      </div>

      {/* Daily Turnover Chart (Switchable between Line & Bar) */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Layers className="w-5 h-5 text-sky-500" />
              <span>Daily Turnover Trend ({currentYm})</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Daily revenue figures updating automatically as bills are saved.
            </p>
          </div>

          {/* Toggle between Line and Bar Chart */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setChartMode('line')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                chartMode === 'line'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LineChartIcon className="w-3.5 h-3.5" />
              <span>Line</span>
            </button>
            <button
              onClick={() => setChartMode('bar')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                chartMode === 'bar'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Bars</span>
            </button>
          </div>
        </div>

        {/* Chart Container */}
        <div className="h-72 w-full">
          {data?.charts.dailyTrends && data.charts.dailyTrends.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'line' ? (
                <LineChart data={data.charts.dailyTrends} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => v.slice(8)} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${currencySymbol}${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#1e293b',
                      borderRadius: '0.75rem',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => [`${currencySymbol}${Number(val).toFixed(2)}`, 'Revenue']}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#0ea5e9"
                    strokeWidth={3}
                    dot={{ fill: '#0ea5e9', r: 4 }}
                    activeDot={{ r: 6, fill: '#38bdf8' }}
                  />
                </LineChart>
              ) : (
                <BarChart data={data.charts.dailyTrends} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => v.slice(8)} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${currencySymbol}${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#1e293b',
                      borderRadius: '0.75rem',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => [`${currencySymbol}${Number(val).toFixed(2)}`, 'Revenue']}
                  />
                  <Bar dataKey="revenue" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              No daily revenue recorded for this period yet.
            </div>
          )}
        </div>
      </div>

      {/* Today's Bills Quick List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Today's Bills ({todayBills.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live checks written on {todayStr}
            </p>
          </div>
          <button
            onClick={() => onNavigate('bills')}
            className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-1"
          >
            <span>View All Centre Bills</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {todayBills.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No bills written yet today. Click "Write New Bill" to create a check.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Check #</th>
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4">Guest Name</th>
                  <th className="py-3 px-4">Nationality</th>
                  <th className="py-3 px-4">Gross</th>
                  <th className="py-3 px-4">SC</th>
                  <th className="py-3 px-4">Tax</th>
                  <th className="py-3 px-4">Tip</th>
                  <th className="py-3 px-4 font-extrabold text-slate-900 dark:text-white">Net Total</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {todayBills.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-sky-600 dark:text-sky-400">
                      #{b.checkNumber}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                      Room {b.roomNumber}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                      {b.guestName}
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {b.nationality}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {currencySymbol}{b.grossAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {currencySymbol}{b.serviceChargeAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {currencySymbol}{b.taxAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {currencySymbol}{b.tipAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      {currencySymbol}{b.netAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      {b.status === 'ACTIVE' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          Active
                        </span>
                      ) : b.status === 'REBATED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Rebated
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          Deleted
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
