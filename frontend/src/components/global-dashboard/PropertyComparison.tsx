import { TableScroll } from '../TableScroll';

import { ArrowUpRight, Search } from 'lucide-react';
import { displayDate } from '../../utils/dates';
import { formatMoney } from '../../utils/format';
import type { GlobalDashboardModel } from './useGlobalDashboardController';

export function PropertyComparison({ model }: { model: GlobalDashboardModel }) {
  const {
    currency, data, investigate, search,
    setCurrency, setSearch, setSort, sort,
    visible,
  } = model;
  if (!data) return null;
  return (
    <section className="surface p-5 sm:p-6 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4" aria-label="Property comparison">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h2 className="text-lg font-bold">Compare properties</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
          {displayDate(data.period.startDate)} – {displayDate(data.period.endDate)}
        </span>
      </div>

      {/* Filter Controls */}
      <div className="global-dashboard-filters grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Find property
          <div className="relative flex items-center">
            <Search size={16} className="absolute left-3 text-gray-400" />
            <input
              type="search"
              placeholder="Name or code"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Currency
          <select
            value={currency}
            onChange={event => setCurrency(event.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="" className="dark:bg-gray-900">All currencies</option>
            {data.totals.currencies.map(total => <option key={total.currency} className="dark:bg-gray-900">{total.currency}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Sort by
          <select
            value={sort}
            onChange={event => setSort(event.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="name" className="dark:bg-gray-900">Property name</option>
            <option value="revenue" className="dark:bg-gray-900">Highest revenue within currency</option>
            <option value="discounts" className="dark:bg-gray-900">Highest discounts within currency</option>
            <option value="commissions" className="dark:bg-gray-900">Highest commissions within currency</option>
            <option value="missingAttendance" className="dark:bg-gray-900">Most missing attendance</option>
          </select>
        </label>
      </div>

      {/* Table */}
      <TableScroll label="Property comparison" className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-xl mt-4">
        <table className="global-comparison-table w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <th className="p-3">Property</th>
              <th className="p-3">Revenue</th>
              <th className="p-3">Discounts</th>
              <th className="p-3">Commissions</th>
              <th className="p-3">Missing attendance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800 text-sm">
            {visible.map(row => (
              <tr key={row.propertyId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                <th scope="row" className="p-3 font-normal text-left">
                  <button
                    className="text-button font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                    aria-label={`Open property overview for ${row.name}`}
                    onClick={() => investigate(row, 'overview')}
                  >
                    {row.name}
                  </button>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {row.code} · {row.currency}{!row.isActive && ' · Inactive'}
                  </span>
                </th>
                {(['revenue', 'discounts', 'commissions'] as const).map(kind => (
                  <td key={kind} className="p-3">
                    <button
                      className="text-button inline-flex items-center gap-1 font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      aria-label={`Investigate ${kind} for ${row.name}`}
                      onClick={() => investigate(row, kind)}
                    >
                      {formatMoney(row[kind], `${row.currency} `)}
                      <ArrowUpRight size={14} className="text-gray-400" />
                    </button>
                    {kind === 'revenue' && <small className="block text-xs text-gray-500 dark:text-gray-400">{row.billCount} active bills</small>}
                  </td>
                ))}
                <td className="p-3">
                  {row.firstMissingDate ? (
                    <button
                      className="text-button attendance-warning inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                      aria-label={`Investigate missing attendance for ${row.name}`}
                      onClick={() => investigate(row, 'attendance')}
                    >
                      {row.missingAttendance} entries
                      <ArrowUpRight size={14} />
                    </button>
                  ) : (
                    <strong className="font-semibold text-emerald-600 dark:text-emerald-400">0 entries</strong>
                  )}
                  <small className="block text-xs text-gray-500 dark:text-gray-400">
                    {row.missingDays} incomplete days{row.firstMissingDate && ` · first ${displayDate(row.firstMissingDate)}`}
                  </small>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-500 dark:text-gray-400">
                  {data.properties.length ? 'No properties match these filters.' : 'No properties yet. Create a property in Administration.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
    </section>
  );
}
