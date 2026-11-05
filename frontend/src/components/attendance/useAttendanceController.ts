import { useMonthLock } from '../../hooks/useMonthLock';
import { useAuth } from '../../context/AuthContext';
import { useNavigation, useUnsavedChanges } from '../../context/NavigationContext';
import { attendanceSnapshot } from '../../utils/attendance';
import { businessToday, isBusinessDate } from '../../utils/dates';
import { useState, useEffect, useRef } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { apiFetch } from '../../services/api';
import { MonthPresenceStatus, AttendanceItem } from '../../types';

export interface AttendanceProps { initialDate?: string; onSetup: () => void; onPayroll: () => void }

export function useAttendanceController({ initialDate, onSetup, onPayroll }: AttendanceProps) {
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

  return {
    activeProperty,
    baseline,
    canManage,
    daysInMonth,
    dirty,
    errorMsg,
    fetchDayAttendance,
    fetchMonthStatus,
    firstDayOfWeek,
    handleAllPresent,
    handleSaveAttendance,
    handleStatusChange,
    loadingDay,
    loadingMonth,
    monthLock,
    monthNames,
    monthNum,
    monthStatus,
    nextMonth,
    onPayroll,
    onSetup,
    prevMonth,
    readOnly,
    saveSuccess,
    saving,
    selectDate,
    selectedDate,
    selectedYm,
    setErrorMsg,
    staffAttendance,
    todayStr,
    yearNum,
  };
}
export type AttendanceModel = ReturnType<typeof useAttendanceController>;
