import { useMonthLock } from '../hooks/useMonthLock';
import { useAuth } from '../context/AuthContext';
import { useNavigation, useUnsavedChanges } from '../context/NavigationContext';
import { attendanceSnapshot, attendanceDayState } from '../utils/attendance';
import { businessToday, displayDate, isBusinessDate } from '../utils/dates';
import React, { useState, useEffect, useRef } from 'react';
import { useProperty } from '../context/PropertyContext';
import { apiFetch } from '../services/api';
import { MonthPresenceStatus, AttendanceItem } from '../types';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  AlertTriangle,
  Users,
  Check,
  ChevronLeft,
  ChevronRight,
  Save,
  HelpCircle,
  Clock,
  Sparkles,
} from 'lucide-react';

export const PresenceView: React.FC<{ initialDate?: string; onSetup: () => void; onPayroll: () => void }> = ({ initialDate, onSetup, onPayroll }) => {
  const { activeProperty } = useProperty();
  const { user } = useAuth();
  const canManage = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const { requestNavigation } = useNavigation();
  const dayRequest = useRef(0);
  const monthRequest = useRef(0);
  const [baseline, setBaseline] = useState('[]');

  const todayStr = businessToday();
  const currentYm = todayStr.substring(0, 7);

  const [selectedYm, setSelectedYm] = useState<string>(isBusinessDate(initialDate) ? initialDate.slice(0, 7) : currentYm);
  const [selectedDate, setSelectedDate] = useState<string>(isBusinessDate(initialDate) ? initialDate : todayStr);

  const monthLock = useMonthLock(activeProperty?.id, selectedYm);
  const readOnly = monthLock.locked !== false;
  const [monthStatus, setMonthStatus] = useState<MonthPresenceStatus | null>(null);
  const [staffAttendance, setStaffAttendance] = useState<AttendanceItem[]>([]);
  const [loadingMonth, setLoadingMonth] = useState<boolean>(true);
  const [loadingDay, setLoadingDay] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const dirty = attendanceSnapshot(staffAttendance) !== baseline;
  const releaseGuard = useUnsavedChanges(dirty, saving ? 'Attendance is being saved. Please wait for confirmation.' : 'Attendance has unsaved changes. Leaving this screen will discard those changes.', saving);
  const selectDate = (date: string) => {
    if (date === selectedDate) return;
    requestNavigation(() => { setSelectedDate(date); setSelectedYm(date.slice(0, 7)); });
  };
  useEffect(() => {
    if (isBusinessDate(initialDate)) {
      setSelectedDate(initialDate); setSelectedYm(initialDate.slice(0, 7));
    }
  }, [initialDate]);
  // Load Month Presence Status (calendar dots & missing days counter)
  const fetchMonthStatus = async () => {
    if (!activeProperty) return;
    const request = ++monthRequest.current;
    try {
      setLoadingMonth(true);
      const res = await apiFetch<MonthPresenceStatus>(
        `/presence/month-status?propertyId=${activeProperty.id}&yearMonth=${selectedYm}`
      );
      if (request !== monthRequest.current) return;
      setMonthStatus(res);
    } catch (err) {
      if (request !== monthRequest.current) return;
      setErrorMsg('Could not load the attendance calendar. Please try again.');
    } finally {
      if (request === monthRequest.current) setLoadingMonth(false);
    }
  };

  // Load Day Attendance Roster
  const fetchDayAttendance = async () => {
    if (!activeProperty || !selectedDate) return;
    const request = ++dayRequest.current;
    try {
      setLoadingDay(true);
      setErrorMsg(null);
      setSaveSuccess(false);
      const res = await apiFetch<{ date: string; staff: AttendanceItem[] }>(
        `/presence/day?propertyId=${activeProperty.id}&date=${selectedDate}`
      );
      if (request !== dayRequest.current) return;
      setStaffAttendance(res.staff);
      setBaseline(attendanceSnapshot(res.staff));
    } catch (err) {
      if (request !== dayRequest.current) return;
      setStaffAttendance([]); setBaseline('[]');
      setErrorMsg('Could not load the team roster. Please try again.');
    } finally {
      if (request === dayRequest.current) setLoadingDay(false);
    }
  };

  useEffect(() => {
    fetchMonthStatus();
    return () => { monthRequest.current++; };
  }, [activeProperty, selectedYm]);

  useEffect(() => {
    fetchDayAttendance();
    return () => { dayRequest.current++; };
  }, [activeProperty, selectedDate]);

  // Bulk action: "All present" (PDF Page 5)
  const handleAllPresent = () => {
    setSaveSuccess(false);
    setStaffAttendance((prev) =>
      prev.map((item) => ({
        ...item,
        status: 'PRESENT',
      }))
    );
  };

  const handleStatusChange = (staffId: string, status: AttendanceItem['status']) => {
    setSaveSuccess(false);
    setStaffAttendance((prev) =>
      prev.map((item) =>
        item.staffMemberId === staffId ? { ...item, status } : item
      )
    );
  };

  const handleNoteChange = (staffId: string, note: string) => {
    setStaffAttendance((prev) =>
      prev.map((item) =>
        item.staffMemberId === staffId ? { ...item, note } : item
      )
    );
  };

  const handleSaveAttendance = async () => {
    if (!activeProperty || readOnly) return;
    try {
      setSaving(true);
      setErrorMsg(null);
      await apiFetch('/presence/day', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: activeProperty.id,
          date: selectedDate,
          records: staffAttendance.map((s) => ({
            staffMemberId: s.staffMemberId,
            status: s.status,
            note: s.note || null,
          })),
        }),
      });

      setBaseline(attendanceSnapshot(staffAttendance));
      setStaffAttendance(records => records.map(record => ({ ...record, isSaved: true })));
      releaseGuard();
      setSaveSuccess(true);
      fetchMonthStatus();

    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save attendance.');
    } finally {
      setSaving(false);
    }
  };

  // Calendar generation for selectedYm
  const [yearNum, monthNum] = selectedYm.split('-').map(Number);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const firstDayOfWeek = new Date(yearNum, monthNum - 1, 1).getDay(); // 0 is Sunday

  const prevMonth = () => {
    const d = new Date(yearNum, monthNum - 2, 1);
    const newYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    selectDate(`${newYm}-01`);
  };

  const nextMonth = () => {
    const d = new Date(yearNum, monthNum, 1);
    const newYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    selectDate(`${newYm}-01`);
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner with Missing Days Counter (PDF Page 5) */}
      <div className="feature-heading bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-sm font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
            <Users className="w-4 h-4" />
            <span>DAILY OPERATIONS</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            Team attendance
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Record attendance for your dive team and keep daily commission shares up to date.
          </p>
        </div>

        {/* Counter for "N days missing this month" */}
        {monthStatus && (
          <div className="flex items-center space-x-3 bg-slate-50 dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
              monthStatus.missingDaysCount > 0
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
              <div className="text-xs text-slate-400">
                Past dates that need your attention
              </div>
            </div>
          </div>
        )}
      </div>

      {errorMsg && <div role="alert" className="notice notice-error"><AlertTriangle size={18} /><span>{errorMsg}</span><button onClick={() => { setErrorMsg(null); fetchMonthStatus(); fetchDayAttendance(); }}>Try again</button></div>}
      {monthLock.locked && <div className="notice notice-info"><span>This month is locked for payroll. Attendance is read-only.{!canManage && ' Ask your property manager if a correction is needed.'}</span>{canManage && <button onClick={onPayroll}>Review payroll lock</button>}</div>}
      {monthLock.error && <div className="notice notice-error" role="alert"><span>Could not check payroll status. Attendance edits are paused.</span><button onClick={monthLock.retry}>Retry</button></div>}
      {/* Two-column layout: Calendar on Left, Register on Right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Calendar Month Picker */}
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
                    className={`h-11 rounded-xl p-1 flex flex-col items-center justify-between transition border text-sm font-semibold relative ${
                      isSelected
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

        {/* Right: Daily Register for Selected Date */}
        <div className="xl:col-span-7 space-y-4">
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                  <span>{displayDate(selectedDate)}</span>
                  {selectedDate === todayStr && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                      Today
                    </span>
                  )}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {staffAttendance.length} dive staff employed on this date
                </p>
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
              <div className="space-y-3">
                {staffAttendance.map((staff) => {
                  const original = (JSON.parse(baseline) as { id: string; status: string; note: string }[]).find(record => record.id === staff.staffMemberId);
                  const changed = original && (original.status !== staff.status || original.note !== (staff.note || ''));
                  const countsTowardCommission = ['PRESENT', 'OFF', 'OFF_HALF'].includes(staff.status);

                  return (
                    <div
                      key={staff.staffMemberId}
                      className={`attendance-row ${changed ? 'is-dirty' : ''} p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm`}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {staff.staffName}
                          </span><span className="attendance-row-status">{changed ? 'Unsaved' : staff.isSaved ? 'Saved' : 'Not recorded'}</span>
                          <span className="text-xs text-slate-400 font-medium">
                            • {staff.roleTitle}
                          </span>
                          {staff.isBaseLeaderOverride && (
                            <span className="px-1.5 py-0.2 rounded text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              +10% Override
                            </span>
                          )}
                        </div>

                        {/* Commission Impact Indicator */}
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center space-x-1">
                          <span>Commission Pool:</span>
                          {countsTowardCommission ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                              {staff.isSaved && !changed ? "✓ Included in day's pool" : 'Would count when saved'}
                            </span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">
                              {staff.isSaved && !changed ? '✕ Excluded from pool' : 'Would be excluded when saved'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status Dropdown */}
                      <div className="flex items-center space-x-2">
                        <select
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
                          <option value="PRESENT">Present (Full Pool)</option>
                          <option value="OFF">Off (Counts Full)</option>
                          <option value="OFF_HALF">Off (Half Day - Counts Full)</option>
                          <option value="ANNUAL_LEAVE">Annual Leave (Excluded)</option>
                          <option value="SICK">Sick (Excluded)</option>
                          <option value="ABSENT">Absent (Excluded)</option>
                          <option value="EMERGENCY_LEAVE">Emergency Leave (Excluded)</option>
                        </select>
                      </div>
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
      </div>
    </div>
  );
};
