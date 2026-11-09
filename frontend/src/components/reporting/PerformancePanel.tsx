import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Download } from 'lucide-react';
import { formatMoney } from '../../utils/format';
import type { ReportPanelProps } from './types';

export function PerformancePanel({ report, currencySymbol, downloadChartCsv }: ReportPanelProps) {
  return (
<section id="panel-performance" role="tabpanel" aria-labelledby="tab-performance" className="space-y-6">
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
                    contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--ink)', fontSize: '12px' }}
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
                    contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--ink)', fontSize: '12px' }}
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
                    contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--ink)', fontSize: '12px' }}
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

      </section>
  );
}
