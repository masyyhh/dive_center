import { Users } from 'lucide-react';
import type { AttendanceModel } from './useAttendanceController';

export function AttendanceSummary({ model }: { model: AttendanceModel }) {
  const {
    monthStatus,
  } = model;
  return (
    <div className="feature-heading bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div className="flex items-center space-x-2 text-sm font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
          <Users className="w-4 h-4" />
          <span>DAILY OPERATIONS</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
          Team attendance
        </h1>

      </div>

      {/* Counter for "N days missing this month" */}
      {monthStatus && (
        <div className="flex items-center space-x-3 bg-slate-50 dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${monthStatus.missingDaysCount > 0
              ? 'bg-rose-500 text-white'
              : 'bg-emerald-500 text-white'
            }`}>
            {monthStatus.missingDaysCount}
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {monthStatus.missingDaysCount === 0
                ? 'All days up-to-date'
                : `${monthStatus.missingDaysCount} day${monthStatus.missingDaysCount > 1 ? 's' : ''} missing this month`}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
