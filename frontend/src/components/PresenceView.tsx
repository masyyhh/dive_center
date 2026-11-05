import { isSiyamWorld } from '../utils/propertyPresentation';
import { isBusinessDate } from '../utils/dates';
import { AlertTriangle } from 'lucide-react';
import { useAttendanceController } from './attendance/useAttendanceController';
import type { AttendanceProps } from './attendance/useAttendanceController';
import { AttendanceSummary } from './attendance/AttendanceSummary';
import { AttendanceCalendar } from './attendance/AttendanceCalendar';
import { AttendanceRegister } from './attendance/AttendanceRegister';

export function PresenceView(props: AttendanceProps) {
  const model = useAttendanceController(props);
  const { canManage, errorMsg, fetchDayAttendance, fetchMonthStatus, monthLock, onPayroll, setErrorMsg } = model;
  const compact = isSiyamWorld(model.activeProperty);
  return (
    <div className={compact ? "siyam-attendance space-y-4" : "space-y-6"}>
      {/* Top Banner with Missing Days Counter (PDF Page 5) */}
      <AttendanceSummary model={model} />

      {errorMsg && <div role="alert" className="notice notice-error"><AlertTriangle size={18} /><span>{errorMsg}</span><button onClick={() => { setErrorMsg(null); fetchMonthStatus(); fetchDayAttendance(); }}>Try again</button></div>}
      {monthLock.locked && <div className="notice notice-info"><span>This month is locked for payroll. Attendance is read-only.{!canManage && ' Ask your property manager if a correction is needed.'}</span>{canManage && <button onClick={onPayroll}>Review payroll lock</button>}</div>}
      {monthLock.error && <div className="notice notice-error" role="alert"><span>Could not check payroll status. Attendance edits are paused.</span><button onClick={monthLock.retry}>Retry</button></div>}
      {compact ? <>
        <section className="surface siyam-attendance-toolbar" aria-label="Attendance date controls">
          <label htmlFor="siyam-attendance-date">Attendance date<input id="siyam-attendance-date" type="date" value={model.selectedDate} disabled={model.saving || model.loadingDay} onChange={event => { if (isBusinessDate(event.target.value)) model.selectDate(event.target.value); }} /></label>
          <button type="button" className="secondary-button" disabled={model.saving || model.loadingDay || model.selectedDate === model.todayStr} onClick={() => model.selectDate(model.todayStr)}>Today</button>
          <details className="siyam-attendance-calendar" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
            <summary>Calendar &amp; monthly status</summary><div className="siyam-attendance-calendar-panel"><AttendanceCalendar model={model} /></div>
          </details>
        </section>
        <AttendanceRegister model={model} compact />
      </> : <div className="grid grid-cols-1 xl:grid-cols-12 gap-6"><AttendanceCalendar model={model} /><AttendanceRegister model={model} /></div>}
    </div>
  );
}
