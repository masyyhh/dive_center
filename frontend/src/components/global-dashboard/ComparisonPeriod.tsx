import { CalendarDays } from 'lucide-react';
import type { GlobalDashboardModel } from './useGlobalDashboardController';

export function ComparisonPeriod({ model }: { model: GlobalDashboardModel }) {
  const {
    endDate, setEndDate, setStartDate, startDate,
    today,
  } = model;
  return (
    <section className="surface global-dashboard-filters flex flex-wrap items-center gap-4 p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm" aria-label="Comparison period">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <CalendarDays size={18} />
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        From
        <input
          type="date"
          value={startDate}
          onChange={event => setStartDate(event.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        To
        <input
          type="date"
          value={endDate}
          onChange={event => setEndDate(event.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>
      <div className="flex items-center gap-2 ml-auto">
        <button
          className="text-button px-3 py-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg transition-colors"
          onClick={() => { setStartDate(`${today.slice(0, 7)}-01`); setEndDate(today); }}
        >
          Month to date
        </button>
        <button
          className="text-button px-3 py-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg transition-colors"
          onClick={() => {
            const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
            date.setUTCDate(0);
            const end = date.toISOString().slice(0, 10);
            setStartDate(`${end.slice(0, 7)}-01`);
            setEndDate(end);
          }}
        >
          Last month
        </button>
      </div>
    </section>
  );
}
