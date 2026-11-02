import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, Building2, CalendarDays, RefreshCw } from 'lucide-react';
import { useProperty } from '../context/PropertyContext';
import { useNavigation } from '../context/NavigationContext';
import { apiFetch } from '../services/api';
import { GlobalDashboardProperty, GlobalDashboardReport } from '../types';
import { businessToday, displayDate, isBusinessDate } from '../utils/dates';
import { investigationSection } from '../utils/dashboardNavigation';
import { formatMoney } from '../utils/format';
import { NavTab } from './SubNav';

export const GlobalDashboard: React.FC<{ onNavigate: (tab: NavTab, section?: string) => void }> = ({ onNavigate }) => {
  const today = businessToday();
  const { properties, setActiveProperty } = useProperty();
  const { requestNavigation } = useNavigation();
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState<GlobalDashboardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState('');
  const [sort, setSort] = useState('name');
  const [version, setVersion] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    const generation = ++request.current;
    setData(null); setError('');
    if (!isBusinessDate(startDate) || !isBusinessDate(endDate) || startDate > endDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 >= 366) {
      setError('Choose a valid date range of up to 366 days.'); setLoading(false); return;
    }
    setLoading(true);
    apiFetch<GlobalDashboardReport>(`/reports/global-dashboard?startDate=${startDate}&endDate=${endDate}`)
      .then(result => { if (generation === request.current) setData(result); })
      .catch(err => { if (generation === request.current) setError(err instanceof Error ? err.message : 'Unable to load the global dashboard.'); })
      .finally(() => { if (generation === request.current) setLoading(false); });
    return () => { request.current++; };
  }, [startDate, endDate, version]);
  const investigate = (row: GlobalDashboardProperty, kind: 'revenue' | 'discounts' | 'commissions' | 'attendance' | 'overview') => {
    const property = properties.find(property => property.id === row.propertyId);
    if (!property || !data) return;
    requestNavigation(() => {
      setActiveProperty(property);
      if (kind === 'overview') onNavigate('home', 'property');
      else if (kind === 'attendance') onNavigate('presence', row.firstMissingDate || data.period.startDate);
      else onNavigate(kind === 'commissions' ? 'reporting' : 'bills', investigationSection(kind, data.period.startDate, data.period.endDate));
    });
  };
  const visible = (data?.properties || []).filter(row => (!currency || row.currency === currency) && `${row.name} ${row.code}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'missingAttendance' ? b.missingAttendance - a.missingAttendance || a.name.localeCompare(b.name) : a.currency.localeCompare(b.currency) || b[sort as 'revenue' | 'discounts' | 'commissions'] - a[sort as 'revenue' | 'discounts' | 'commissions']);
  return <div className="dashboard global-dashboard space-y-6">
    <div className="page-heading"><div><span className="eyebrow">GLOBAL ADMINISTRATION</span><h1>All properties overview</h1><p>Compare financial performance and attendance across your dive centres.</p></div><div className="heading-actions"><span className="date-pill"><Building2 size={16} />{data ? `${data.totals.propertyCount} properties` : 'All properties'}</span><button className="secondary-button" disabled={loading} onClick={() => setVersion(value => value + 1)}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />Refresh</button></div></div>
    <section className="surface global-dashboard-filters" aria-label="Comparison period">
      <CalendarDays size={18} /><label>From<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label><label>To<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
      <button className="text-button" onClick={() => { setStartDate(`${today.slice(0, 7)}-01`); setEndDate(today); }}>Month to date</button>
      <button className="text-button" onClick={() => { const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); date.setUTCDate(0); const end = date.toISOString().slice(0, 10); setStartDate(`${end.slice(0, 7)}-01`); setEndDate(end); }}>Last month</button>
    </section>
    {error && <div className="notice notice-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button onClick={() => setVersion(value => value + 1)}>Try again</button></div>}
    {loading && <div className="surface p-6" role="status">Loading property comparisons…</div>}
    {data && <>
      <section className="global-currency-grid" aria-label="Totals by currency">{data.totals.currencies.map(total => <div className="surface p-5" key={total.currency}><h2 className="font-bold">{total.currency} totals</h2><dl className="global-totals"><div><dt>Revenue</dt><dd>{formatMoney(total.revenue, `${total.currency} `)}</dd></div><div><dt>Discounts</dt><dd>{formatMoney(total.discounts, `${total.currency} `)}</dd></div><div><dt>Commissions</dt><dd>{formatMoney(total.commissions, `${total.currency} `)}</dd></div><div><dt>Active bills</dt><dd>{total.billCount}</dd></div></dl></div>)}</section>
      <div className="surface p-5"><strong>{data.totals.missingAttendance} missing attendance {data.totals.missingAttendance === 1 ? 'entry' : 'entries'}</strong><p className="text-sm text-slate-500">One entry per employed, active dive staff member per past day. Today and future dates are excluded. Partial days count.</p></div>
      <section className="surface p-5 space-y-4" aria-label="Property comparison">
        <div className="section-heading"><div><h2>Compare properties</h2><p>{displayDate(data.period.startDate)} – {displayDate(data.period.endDate)} · includes inactive properties; removed properties are excluded.</p></div></div>
        <div className="global-dashboard-filters"><label>Find property<input type="search" placeholder="Name or code" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Currency<select value={currency} onChange={event => setCurrency(event.target.value)}><option value="">All currencies</option>{data.totals.currencies.map(total => <option key={total.currency}>{total.currency}</option>)}</select></label><label>Sort by<select value={sort} onChange={event => setSort(event.target.value)}><option value="name">Property name</option><option value="revenue">Highest revenue within currency</option><option value="discounts">Highest discounts within currency</option><option value="commissions">Highest commissions within currency</option><option value="missingAttendance">Most missing attendance</option></select></label></div>
        <p className="text-sm text-slate-500">Revenue = gross sales less discounts, before service charge, tax and tips. Financial figures use active bills only. Commissions match staff payroll, including tips. Currencies are shown separately without conversion. Summary totals cover all properties.</p>
        <div className="overflow-x-auto"><table className="global-comparison-table"><thead><tr><th>Property</th><th>Revenue</th><th>Discounts</th><th>Commissions</th><th>Missing attendance</th></tr></thead><tbody>
          {visible.map(row => <tr key={row.propertyId}><th scope="row"><button className="text-button" aria-label={`Open property overview for ${row.name}`} onClick={() => investigate(row, 'overview')}>{row.name}</button><span>{row.code} · {row.currency}{!row.isActive && ' · Inactive'}</span></th>{(['revenue', 'discounts', 'commissions'] as const).map(kind => <td key={kind}><button className="text-button" aria-label={`Investigate ${kind} for ${row.name}`} onClick={() => investigate(row, kind)}>{formatMoney(row[kind], `${row.currency} `)}<ArrowUpRight size={14} /></button>{kind === 'revenue' && <small>{row.billCount} active bills</small>}</td>)}<td>{row.firstMissingDate ? <button className="text-button attendance-warning" aria-label={`Investigate missing attendance for ${row.name}`} onClick={() => investigate(row, 'attendance')}>{row.missingAttendance} entries<ArrowUpRight size={14} /></button> : <strong>0 entries</strong>}<small>{row.missingDays} incomplete days{row.firstMissingDate && ` · first ${displayDate(row.firstMissingDate)}`}</small></td></tr>)}
          {!visible.length && <tr><td colSpan={5} className="p-6 text-center">{data.properties.length ? 'No properties match these filters.' : 'No properties yet. Create a property in Administration.'}</td></tr>}
        </tbody></table></div>
        <p className="text-sm text-slate-500">Select a financial figure to open its property and date range. Missing attendance opens the first incomplete date. Commissions may change while attendance is incomplete.</p>
      </section>
    </>}
  </div>;
};
