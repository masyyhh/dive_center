import { useEffect, useRef, useState } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { useNavigation } from '../../context/NavigationContext';
import { apiFetch } from '../../services/api';
import { GlobalDashboardProperty, GlobalDashboardReport } from '../../types';
import { businessToday, isBusinessDate } from '../../utils/dates';
import { investigationSection } from '../../utils/dashboardNavigation';
import { NavTab } from '../SubNav';

export interface GlobalDashboardProps { onNavigate: (tab: NavTab, section?: string) => void }

export function useGlobalDashboardController({ onNavigate }: GlobalDashboardProps) {
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

  return {
    currency,
    data,
    endDate,
    error,
    investigate,
    loading,
    search,
    setCurrency,
    setEndDate,
    setSearch,
    setSort,
    setStartDate,
    setVersion,
    sort,
    startDate,
    today,
    visible,
  };
}
export type GlobalDashboardModel = ReturnType<typeof useGlobalDashboardController>;
