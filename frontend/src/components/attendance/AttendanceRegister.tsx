import { displayDate } from '../../utils/dates';

import { AttendanceItem } from '../../types';
import { CheckCircle2, Users, Save, Sparkles } from 'lucide-react';
import type { AttendanceModel } from './useAttendanceController';

const statusLabels: Record<AttendanceItem['status'], string> = { BASIC: 'Basic', PRESENT: 'Present', OFF: 'Off', OFF_HALF: 'Off (half day)', ANNUAL_LEAVE: 'Annual leave', SICK: 'Sick', ABSENT: 'Absent', EMERGENCY_LEAVE: 'Emergency leave' };

export function AttendanceRegister({ model, compact = false }: { model: AttendanceModel; compact?: boolean }) {
  const {
    baseline, canManage, dirty, handleAllPresent,
    handleSaveAttendance, handleStatusChange, loadingDay, monthLock,
    onSetup, readOnly, saveSuccess, saving,
    selectedDate, staffAttendance, todayStr,
  } = model;
  return (
    <div className={compact ? "siyam-attendance-register space-y-4" : "xl:col-span-7 space-y-4"}>
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <span>{compact ? `Staff attendance (${staffAttendance.length})` : displayDate(selectedDate)}</span>
              {!compact && selectedDate === todayStr && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                  Today
                </span>
              )}
            </h3>
            {!compact && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {staffAttendance.length} {compact ? 'staff' : 'dive staff employed on this date'}
            </p>}
          </div>

          {/* Bulk "All present" button (PDF Page 5) */}
          <button
            type="button"
            onClick={handleAllPresent}
            disabled={readOnly || loadingDay || staffAttendance.length === 0 || saving}
            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1.5 self-start sm:self-auto"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-500" />
            <span>All Present</span>
          </button>
        </div>

        {saveSuccess && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Attendance saved. Your calendar is up to date.</span>
          </div>
        )}

        {/* Staff Attendance List */}
        {loadingDay ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading roster...</div>
        ) : staffAttendance.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            <Users className="mx-auto mb-3" size={28} /><strong className="block mb-2">No dive staff on this date</strong><span>{canManage ? 'Add your dive team, or choose a date within their employment period.' : 'Ask your property manager to add the dive team, or choose another date.'}</span>{canManage && <button className="primary-button mt-4" onClick={onSetup}>Add team members</button>}
          </div>
        ) : (
          <div className={compact ? "siyam-attendance-roster" : "space-y-3"}>
            {staffAttendance.map((staff) => {
              const original = (JSON.parse(baseline) as { id: string; status: string; note: string }[]).find(record => record.id === staff.staffMemberId);
              const changed = original && (original.status !== staff.status || original.note !== (staff.note || ''));
              const countsTowardCommission = ['PRESENT', 'OFF', 'OFF_HALF'].includes(staff.status);

              return (
                <div
                  key={staff.staffMemberId}
                  className={`attendance-row ${changed ? 'is-dirty' : ''} p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm`}
                >
                  <div className="attendance-staff-identity">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {staff.staffName}
                      </span><span className="attendance-row-status">{changed ? 'Unsaved' : staff.isSaved ? 'Saved' : 'Not recorded'}</span>
                      <span className="text-xs text-slate-400 font-medium">
                        • {staff.roleTitle}
                      </span>
                      {staff.isBaseLeaderOverride && staff.status !== 'BASIC' && (
                        <span className="px-1.5 py-0.2 rounded text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          +10% Override
                        </span>
                      )}
                    </div>

                    {/* Commission Impact Indicator */}
                    {!compact && <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center space-x-1">
                      <span>{staff.status === 'BASIC' ? 'Basic:' : 'Commission Pool:'}</span>
                      {countsTowardCommission ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                          {staff.isSaved && !changed ? "✓ Included in day's pool" : 'Would count when saved'}
                        </span>
                      ) : (
                        <span className="text-rose-600 dark:text-rose-400 font-semibold">
                          {staff.status === 'BASIC' ? 'No pool or personal commission' : staff.isSaved && !changed ? '✕ Excluded from pool' : 'Would be excluded when saved'}
                        </span>
                      )}
                    </div>}
                  </div>

                  {/* Status Dropdown */}
                  <div className={compact ? "siyam-attendance-status-control" : "flex items-center space-x-2"}>
                    {compact && <label htmlFor={`attendance-status-${staff.staffMemberId}`}>Status</label>}
                    <select id={`attendance-status-${staff.staffMemberId}`}
                      aria-label={`Attendance for ${staff.staffName}`}
                      value={staff.status}
                      disabled={readOnly || saving || loadingDay}
                      onChange={(e) =>
                        handleStatusChange(
                          staff.staffMemberId,
                          e.target.value as AttendanceItem['status']
                        )
                      }
                      className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer"
                    >
                      <option value="BASIC">Basic (No pool or personal commission)</option>
                      <option value="PRESENT">Present (Full Pool)</option>
                      <option value="OFF">Off (Counts Full)</option>
                      <option value="OFF_HALF">Off (Half Day - Counts Full)</option>
                      <option value="ANNUAL_LEAVE">Annual Leave (Excluded)</option>
                      <option value="SICK">Sick (Excluded)</option>
                      <option value="ABSENT">Absent (Excluded)</option>
                      <option value="EMERGENCY_LEAVE">Emergency Leave (Excluded)</option>
                    </select>
                  </div>
                  {compact && <>
                    <div className="siyam-attendance-row-date"><span>Date</span><time dateTime={selectedDate}>{displayDate(selectedDate, { day: '2-digit', month: 'short', year: 'numeric' })}</time></div>
                    <div className="siyam-attendance-saved"><span>Saved status</span><strong>{staff.isSaved && original ? statusLabels[original.status as AttendanceItem['status']] : 'Not recorded'}</strong></div>
                  </>}
                </div>
              );
            })}
          </div>
        )}

        <div className="attendance-save-bar">
          <p className="save-status" role="status">{monthLock.locked ? 'Read-only · month locked for payroll' : monthLock.locked === null ? 'Checking payroll status…' : dirty ? 'Unsaved changes' : staffAttendance.some(staff => !staff.isSaved) ? 'Attendance is not recorded for this date' : staffAttendance.length ? 'All changes saved' : 'No attendance to record'}</p>
          {/* Save Button */}
          <button
            type="button"
            disabled={readOnly || saving || loadingDay || staffAttendance.length === 0 || (!dirty && staffAttendance.every(staff => staff.isSaved))}
            onClick={handleSaveAttendance}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-teal-500 hover:from-sky-600 hover:to-teal-600 text-white font-bold text-sm shadow-md shadow-sky-500/20 transition flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : `Save attendance · ${displayDate(selectedDate, { day: 'numeric', month: 'short' })}`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
