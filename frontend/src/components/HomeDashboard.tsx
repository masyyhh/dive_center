import { formatMoney } from '../utils/format';
import React, { useEffect, useState } from 'react';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';
import { SetupChecklist } from './SetupChecklist';
import { DashboardReport, Bill, MonthPresenceStatus, Item, StaffMember } from '../types';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { CheckCircle2, LockKeyhole, Wallet, Receipt, TrendingUp, ArrowRight, Plus, CalendarDays, RefreshCw, BarChart3, ChartNoAxesCombined, Users, ArrowUpRight, AlertCircle } from 'lucide-react';
import { NavTab } from './SubNav';
import { businessToday, displayDate } from '../utils/dates';

export const HomeDashboard: React.FC<{ onNavigate: (tab: NavTab, section?: string) => void }> = ({ onNavigate }) => {
  const { activeProperty } = useProperty();
  const { user } = useAuth();
  const [mode, setMode] = useState<'line' | 'bar'>('line');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<DashboardReport | null>(null);
  const [attendance, setAttendance] = useState<MonthPresenceStatus | null>(null);
  const [setup, setSetup] = useState<{ items: number; staff: number } | null>(null);
  const canManage = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const [bills, setBills] = useState<Bill[]>([]);
  const today = businessToday();
  const month = today.slice(0, 7);
  const money = (value?: number) => formatMoney(value, activeProperty?.currencySymbol || '$');
  const load = async () => {
    if (!activeProperty) return;
    setLoading(true); setError('');
    try {
      const [report, result] = await Promise.all([apiFetch<DashboardReport>(`/reports/dashboard?propertyId=${activeProperty.id}&startDate=${month}-01&endDate=${today}`), apiFetch<{ bills: Bill[] }>(`/bills?propertyId=${activeProperty.id}&startDate=${today}&endDate=${today}`)]);
      setData(report); setBills(result.bills);
      const [presence, catalogue, team] = await Promise.all([
        apiFetch<MonthPresenceStatus>(`/presence/month-status?propertyId=${activeProperty.id}&yearMonth=${month}`),
        apiFetch<{ items: Item[] }>(`/items?propertyId=${activeProperty.id}`),
        apiFetch<{ staff: StaffMember[] }>(`/staff?propertyId=${activeProperty.id}`),
      ]);
      setAttendance(presence); setSetup({ items: catalogue.items.length, staff: team.staff.filter(member => member.isDiveStaff && member.isActive).length });
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load your overview.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [activeProperty, today]);
  const active = bills.filter(b => b.status === 'ACTIVE');
  const todayTotal = active.reduce((sum, b) => sum + b.netAmount, 0);
  const metrics = [
    { label: 'Today’s bill total', value: money(todayTotal), note: `${active.length} active ${active.length === 1 ? 'bill' : 'bills'} today · includes charges & tips`, icon: Wallet, featured: true },
    { label: 'Month-to-date turnover', value: money(data?.headline.turnover), note: 'Gross amount before discounts & charges', icon: TrendingUp },
    { label: 'Bills this month', value: String(data?.headline.billCount || 0), note: `${displayDate(`${month}-01`, { day: 'numeric', month: 'short' })} – ${displayDate(today, { day: 'numeric', month: 'short' })} · active bills`, icon: Receipt },
    { label: 'Average bill', value: money(data?.headline.averageBill), note: 'Average net total this month', icon: ChartNoAxesCombined },
  ];
  const todayAttendance = attendance?.dayStatuses[today];
  const firstMissing = attendance && Object.keys(attendance.dayStatuses).sort().find(date => date <= today && attendance.dayStatuses[date].expectedCount > 0 && attendance.dayStatuses[date].markedCount < attendance.dayStatuses[date].expectedCount);
  const attendanceComplete = todayAttendance && todayAttendance.expectedCount > 0 && todayAttendance.markedCount >= todayAttendance.expectedCount;
  return <div className="dashboard space-y-6">
    <div className="page-heading dashboard-heading"><div><h1>Overview</h1><p>Your daily operations, at a glance.</p></div><div className="heading-actions"><span className="date-pill"><CalendarDays size={16} />{displayDate(today)}</span><button className="icon-button refresh-button" onClick={load} disabled={loading} aria-label="Refresh overview"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button><button className="primary-button" onClick={() => onNavigate('new-bill')}><Plus size={17} />New bill</button></div></div>
    {error && <div className="notice notice-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button onClick={load}>Try again</button></div>}
    {!loading && setup && <SetupChecklist {...setup} canManage={canManage} onSetup={section => onNavigate('admin', section)} />}
    <section className="attention-grid" aria-label="Daily priorities">
      <button className="surface attention-card" onClick={() => onNavigate('presence', firstMissing || today)}><span className={`attention-icon ${firstMissing ? 'needs-attention' : ''}`}><Users size={20} /></span><span><strong>{loading ? 'Checking attendance…' : !attendance ? 'Attendance unavailable' : firstMissing ? 'Attendance needs attention' : todayAttendance?.expectedCount === 0 ? 'No dive staff scheduled' : attendanceComplete ? 'Today’s attendance is complete' : 'Record today’s attendance'}</strong><small>{loading ? 'Loading your team’s status' : !attendance ? 'Open attendance to retry' : firstMissing ? firstMissing === today ? `${todayAttendance?.markedCount || 0} of ${todayAttendance?.expectedCount || 0} staff recorded today` : `Incomplete attendance from ${displayDate(firstMissing, { day: 'numeric', month: 'short' })}` : todayAttendance?.expectedCount === 0 ? 'Check your team and employment dates' : `${todayAttendance?.markedCount || 0} of ${todayAttendance?.expectedCount || 0} staff recorded today`}</small><span className="attention-action">{firstMissing && !data?.period.isLocked ? 'Complete attendance' : 'Review attendance'}<ArrowRight size={14} /></span></span></button>
      <button className="surface attention-card" onClick={() => onNavigate('bills')}><span className="attention-icon"><Receipt size={20} /></span><span><strong>{loading ? 'Loading today’s bills…' : `${active.length} active ${active.length === 1 ? 'bill' : 'bills'} today`}</strong><small>Review guest details and check numbers</small><span className="attention-action">Review bills<ArrowRight size={14} /></span></span></button>
      <button className="surface attention-card" onClick={() => onNavigate('reporting', 'exports')}><span className="attention-icon"><LockKeyhole size={20} /></span><span><strong>{loading ? 'Checking payroll…' : !data ? 'Payroll status unavailable' : data.period.isLocked ? 'This month is locked' : 'This month is open'}</strong><small>{data?.period.isLocked ? 'Bills and attendance are frozen for payroll' : 'Review commissions before closing the month'}</small><span className="attention-action">Open payroll<ArrowRight size={14} /></span></span></button>
    </section>
    <div className="metric-grid" aria-label="Key figures" aria-busy={loading}>{metrics.map(({ label, value, note, icon: Icon, featured }) => <div className={`metric-card ${featured ? 'featured' : ''}`} key={label}><div className="metric-label">{label}</div><strong>{loading ? '—' : error && !data ? 'Unavailable' : value}</strong><p>{note}</p></div>)}</div>
    <div className="dashboard-middle"><section className="surface trend-card"><div className="section-heading"><div><h2>Daily bill totals</h2><p>{displayDate(today, { month: 'long', year: 'numeric' })} · {activeProperty?.currency || 'USD'} · net amounts</p></div><div className="segmented-control" aria-label="Chart type"><button aria-pressed={mode === 'line'} className={mode === 'line' ? 'active' : ''} onClick={() => setMode('line')}><ChartNoAxesCombined size={15} />Line</button><button aria-pressed={mode === 'bar'} className={mode === 'bar' ? 'active' : ''} onClick={() => setMode('bar')}><BarChart3 size={15} />Bar</button></div></div>
      <div className="dashboard-chart">{loading ? <div className="empty-state" role="status"><RefreshCw className="animate-spin" size={24} /><p>Loading daily totals…</p></div> : data?.charts.dailyTrends.length ? <ResponsiveContainer width="100%" height="100%">{mode === 'line' ? <LineChart data={data.charts.dailyTrends} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="4 5" vertical={false} stroke="var(--border)" /><XAxis dataKey="date" tickFormatter={v => v.slice(8)} axisLine={false} tickLine={false} stroke="var(--muted)" fontSize={12} /><YAxis axisLine={false} tickLine={false} stroke="var(--muted)" fontSize={12} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--ink)' }} formatter={(v: number) => [money(v), 'Bill total']} /><Line type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={3} dot={{ r: 3 }} /></LineChart> : <BarChart data={data.charts.dailyTrends} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="4 5" vertical={false} stroke="var(--border)" /><XAxis dataKey="date" tickFormatter={v => v.slice(8)} axisLine={false} tickLine={false} stroke="var(--muted)" fontSize={12} /><YAxis axisLine={false} tickLine={false} stroke="var(--muted)" fontSize={12} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--ink)' }} formatter={(v: number) => [money(v), 'Bill total']} /><Bar dataKey="revenue" fill="var(--accent)" radius={[4, 4, 0, 0]} /></BarChart>}</ResponsiveContainer> : <div className="empty-state"><span className="empty-icon"><BarChart3 size={25} /></span><h3>{error ? 'Daily totals unavailable' : 'A fresh start to the month'}</h3><p>{error ? 'Refresh the overview to try again.' : 'Your daily totals will appear as bills are saved.'}</p>{!error && <button className="text-button" onClick={() => onNavigate('new-bill')}>Create your first bill<ArrowRight size={15} /></button>}</div>}</div><div className="chart-footer"><span><i />Saved bill net totals</span><span>Business dates · Indian/Maldives</span></div>
    </section></div>
    <section className="surface recent-bills"><div className="section-heading"><div><h2>Today’s bills <span className="count-badge">{bills.length}</span></h2><p>Recent checks from your front desk</p></div><button className="text-button" onClick={() => onNavigate('bills')}>View all bills<ArrowRight size={16} /></button></div>{bills.length ? <div className="overflow-x-auto"><table><thead><tr><th>Check</th><th>Guest</th><th>Room</th><th>Status</th><th className="text-right">Net total</th></tr></thead><tbody>{bills.slice(0, 6).map(b => <tr key={b.id}><td><button className="text-button" onClick={() => onNavigate('bills')}>#{b.checkNumber}</button></td><td>{b.guestName}</td><td>{b.roomNumber}</td><td><span className={`status-badge status-${b.status.toLowerCase()}`}>{b.status.toLowerCase()}</span></td><td className="text-right font-semibold">{money(b.netAmount)}</td></tr>)}</tbody></table></div> : <div className="recent-empty"><Receipt size={21} /><p>{loading ? 'Loading today’s bills…' : error ? 'Could not load today’s bills.' : 'No bills saved today. Ready when your first guest is.'}</p></div>}</section>
  </div>;
};