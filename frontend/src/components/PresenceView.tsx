import { AlertTriangle } from 'lucide-react';
import { useAttendanceController } from './attendance/useAttendanceController';
import type { AttendanceProps } from './attendance/useAttendanceController';
import { AttendanceSummary } from './attendance/AttendanceSummary';
import { AttendanceCalendar } from './attendance/AttendanceCalendar';
import { AttendanceRegister } from './attendance/AttendanceRegister';

export function PresenceView(props: AttendanceProps) {
  const model = useAttendanceController(props);
  const { canManage, errorMsg, fetchDayAttendance, fetchMonthStatus, monthLock, onPayroll, setErrorMsg } = model;
  return (
    <div className="space-y-6">
      {/* Top Banner with Missing Days Counter (PDF Page 5) */}
      <AttendanceSummary model={model} />

      {errorMsg && <div role="alert" className="notice notice-error"><AlertTriangle size={18} /><span>{errorMsg}</span><button onClick={() => { setErrorMsg(null); fetchMonthStatus(); fetchDayAttendance(); }}>Try again</button></div>}
      {monthLock.locked && <div className="notice notice-info"><span>This month is locked for payroll. Attendance is read-only.{!canManage && ' Ask your property manager if a correction is needed.'}</span>{canManage && <button onClick={onPayroll}>Review payroll lock</button>}</div>}
      {monthLock.error && <div className="notice notice-error" role="alert"><span>Could not check payroll status. Attendance edits are paused.</span><button onClick={monthLock.retry}>Retry</button></div>}
      {/* Two-column layout: Calendar on Left, Register on Right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Calendar Month Picker */}
        <AttendanceCalendar model={model} />

        {/* Right: Daily Register for Selected Date */}
        <AttendanceRegister model={model} />
      </div>
    </div>
  );
}
