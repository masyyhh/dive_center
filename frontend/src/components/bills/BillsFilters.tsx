import { businessToday, displayDate } from '../../utils/dates';

import { Search, AlertTriangle, Receipt } from 'lucide-react';
import type { BillsModel } from './useBillsController';

export function BillsFilters({ model }: { model: BillsModel }) {
  const {
    discountedOnly, endDate, errorMsg, fetchBills,
    handleSearchSubmit, loading, resetFilters, search,
    setDiscountedOnly, setEndDate, setSearch, setStartDate,
    setStatusFilter, startDate, statusFilter, visibleBills,
  } = model;
  return (
    <>
      {/* Top Filter Card */}
      <div className="feature-controls bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Receipt className="w-5 h-5 text-sky-500" />
              <span>Bills</span>
            </h1>
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center space-x-2 text-sm">
            <button
              onClick={() => {
                const today = businessToday();
                setStartDate(today);
                setEndDate(today);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-semibold transition"
            >
              Today
            </button>
            <button
              onClick={() => {
                const ym = new Date().toISOString().substring(0, 7);
                setStartDate(`${ym}-01`);
                setEndDate(businessToday());
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-semibold transition"
            >
              This Month
            </button>
          </div>
        </div>

        {/* Filter controls */}
        <div className="bill-filters grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3 text-sm">
          {/* Search Box */}
          <form onSubmit={handleSearchSubmit} className="bill-search-form">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search bills"
                placeholder="Check, guest or room"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div><button className="primary-button" type="submit" disabled={loading}>Search</button>
          </form>

          {/* Start Date */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium">From:</span>
            <input
              type="date"
              aria-label="Bills from date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* End Date */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium">To:</span>
            <input
              type="date"
              aria-label="Bills to date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {(['ALL', 'ACTIVE', 'REBATED', 'DELETED'] as const).map((st) => (
              <button
                key={st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
                onClick={() => setStatusFilter(st)}
                aria-pressed={statusFilter === st}
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition ${statusFilter === st
                    ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {errorMsg && <div role="alert" className="notice notice-error"><AlertTriangle size={18} /><span>{errorMsg}</span><button onClick={fetchBills}>Try again</button></div>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={discountedOnly} onChange={event => setDiscountedOnly(event.target.checked)} />Only bills with discounts</label>
      <div className="results-toolbar"><p role="status">{loading ? 'Finding bills…' : `${visibleBills.length} ${visibleBills.length === 1 ? 'bill' : 'bills'} found`}<span> · {startDate && endDate ? `${displayDate(startDate)} – ${displayDate(endDate)}` : 'Select dates'}</span></p><button className="secondary-button" onClick={resetFilters}>Reset filters</button></div>
    </>
  );
}
