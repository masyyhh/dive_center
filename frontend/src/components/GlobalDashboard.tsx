import { MetricGuide } from './global-dashboard/MetricGuide';

import { AlertCircle, Building2, RefreshCw, Loader2 } from 'lucide-react';
import { useGlobalDashboardController } from './global-dashboard/useGlobalDashboardController';
import type { GlobalDashboardProps } from './global-dashboard/useGlobalDashboardController';
import { ComparisonPeriod } from './global-dashboard/ComparisonPeriod';
import { CurrencyTotals } from './global-dashboard/CurrencyTotals';
import { PropertyComparison } from './global-dashboard/PropertyComparison';

export function GlobalDashboard(props: GlobalDashboardProps) {
  const model = useGlobalDashboardController(props);
  const { data, error, loading, setVersion } = model;
  return (
    <div className="dashboard global-dashboard space-y-6 text-gray-900 dark:text-gray-100 transition-colors">
      {/* Page Heading */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">All properties overview</h1>
        </div>
        <div className="heading-actions flex items-center gap-3">
          <span className="date-pill inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-medium">
            <Building2 size={16} className="text-gray-500 dark:text-gray-400" />
            {data ? `${data.totals.propertyCount} properties` : 'All properties'}
          </span>
          <button
            className="secondary-button inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium transition-colors disabled:opacity-50"
            disabled={loading}
            onClick={() => setVersion(value => value + 1)}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Date Filters */}
      <ComparisonPeriod model={model} />

      {error && (
        <div className="notice notice-error flex items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300" role="alert">
          <AlertCircle size={18} className="shrink-0" />
          <span className="flex-1 text-sm">{error}</span>
          <button
            onClick={() => setVersion(value => value + 1)}
            className="px-3 py-1 rounded bg-red-100 dark:bg-red-900/40 text-xs font-semibold hover:bg-red-200 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="surface p-12 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-center flex flex-col items-center justify-center gap-3" role="status">
          <Loader2 size={24} className="animate-spin text-indigo-600" />
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Loading property comparisons…</span>
        </div>
      )}

      {data && (
        <>
          {/* Totals by Currency */}
          <CurrencyTotals model={model} />
          <MetricGuide />

          {/* Missing Attendance Summary Alert */}
          {data.totals.missingAttendance > 0 && (
            <div className="surface p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex items-center justify-between shadow-sm">
              <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                ⚠️ {data.totals.missingAttendance} missing attendance {data.totals.missingAttendance === 1 ? 'entry' : 'entries'} detected across properties.
              </span>
            </div>
          )}

          {/* Property Comparison Table Section */}
          <PropertyComparison model={model} />
        </>
      )}
    </div>
  );
}
