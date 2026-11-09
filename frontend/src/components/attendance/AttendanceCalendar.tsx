import { attendanceDayState } from '../../utils/attendance';

import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AttendanceModel } from './useAttendanceController';

export function AttendanceCalendar({ model }: { model: AttendanceModel }) {
  const {
    daysInMonth, firstDayOfWeek, loadingDay, loadingMonth,
    monthNames, monthNum, monthStatus, nextMonth,
    prevMonth, saving, selectDate, selectedDate,
    selectedYm, todayStr, yearNum,
  } = model;
  return (
    <div className="xl:col-span-5 space-y-4">
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        {/* Month Header & Controls */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <CalendarIcon className="w-4 h-4 text-sky-500" />
            <span>
              {monthNames[monthNum - 1]} {yearNum}
            </span>
          </h2>

          <div className="flex items-center space-x-1">
            <button
              onClick={prevMonth}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={nextMonth}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Calendar Days of Week */}
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-400 uppercase">
          <span>Su</span>
          <span>Mo</span>
          <span>Tu</span>
          <span>We</span>
          <span>Th</span>
          <span>Fr</span>
          <span>Sa</span>
        </div>

        {/* Calendar Days Grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {/* Empty leading days */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="h-10 rounded-xl bg-transparent" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dateStr = `${selectedYm}-${String(dayNum).padStart(2, '0')}`;
            const isSelected = selectedDate === dateStr;
            const isToday = todayStr === dateStr;
            const dayInfo = monthStatus?.dayStatuses[dateStr];

            const dayState = attendanceDayState(dayInfo, dateStr, todayStr);
            const dotColor = dayState.tone === 'complete' ? 'bg-emerald-500' : dayState.tone === 'partial' ? 'bg-amber-500' : dayState.tone === 'missing' ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700';
            return (
              <button
                key={dateStr}
                onClick={() => selectDate(dateStr)}
                disabled={saving || loadingDay || loadingMonth}
                aria-pressed={isSelected}
                aria-label={`${dateStr}: ${dayState.label}`}
                title={`${dateStr}: ${dayState.label}`}
                className={`h-11 rounded-xl p-1 flex flex-col items-center justify-between transition border text-sm font-semibold relative ${isSelected
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 shadow-xs ring-2 ring-sky-500/20'
                    : 'border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200'
                  } ${isToday ? 'font-bold' : ''}`}
              >
                <span className="text-xs leading-none mt-0.5">{dayNum}</span>

                {/* Completeness Indicator Dot */}
                <div className="flex items-center space-x-1">
                  <div aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${dotColor}`} /><span className="calendar-state">{dayState.short}</span>
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-slate-500">Each date shows its saved status. “Not set” means attendance is not recorded; “No staff” means no eligible dive team.</p>
        {/* Legend per PDF Page 5 */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-3 items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span>Complete</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            <span>Partial</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
            <span>Missing</span>
          </div>
        </div>
      </div>
    </div>
  );
}
