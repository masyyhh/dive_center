import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { waterSportsEnabled } from '../features';
import { LayoutDashboard, Plus, Receipt, CalendarCheck, BarChart3, Settings, Waves, ArrowUpRight, X } from 'lucide-react';

export type NavTab = 'home' | 'new-bill' | 'bills' | 'presence' | 'reporting' | 'admin' | 'water-sports';
export const navLabels: Record<NavTab, string> = { home: 'Overview', 'water-sports': 'Water sports', 'new-bill': 'New bill', bills: 'Bills', presence: 'Attendance', reporting: 'Reports & payroll', admin: 'Administration' };
interface SubNavProps { currentTab: NavTab; onTabChange: (tab: NavTab) => void; open: boolean; onClose: () => void; }

export const SubNav: React.FC<SubNavProps> = ({ currentTab, onTabChange, open, onClose }) => {
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const sidebar = sidebarRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const workspace = document.querySelector<HTMLElement>('.workspace');
    if (workspace) workspace.inert = true;
    sidebar?.querySelector<HTMLElement>('.sidebar-close')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') || []).filter(el => el.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (workspace) workspace.inert = false; previous?.focus(); };
  }, [open]);
  const { user } = useAuth();
  const canAdmin = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const items = [
    { id: 'home' as NavTab, icon: LayoutDashboard }, { id: 'bills' as NavTab, icon: Receipt },
    ...(waterSportsEnabled ? [{ id: 'water-sports' as NavTab, icon: Waves }] : []),
    { id: 'presence' as NavTab, icon: CalendarCheck }, { id: 'reporting' as NavTab, icon: BarChart3 },
  ];
  const navigate = (tab: NavTab) => { onTabChange(tab); onClose(); };
  return <>
    {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={onClose} />}
    <aside ref={sidebarRef} className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Workspace navigation">
      <a className="brand" href="#home" onClick={event => { event.preventDefault(); navigate('home'); }}><img className="brand-symbol" src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={297} height={170} /><span>Dive Centre<span className="brand-subtitle">Workspace</span></span></a>
      <button className="sidebar-close icon-button" aria-label="Close navigation" onClick={onClose}><X size={20} /></button>
      <button className={`sidebar-create ${currentTab === 'new-bill' ? 'selected' : ''}`} aria-current={currentTab === 'new-bill' ? 'page' : undefined} onClick={() => navigate('new-bill')}><Plus size={18} />New bill</button>
      <span className="eyebrow nav-caption">Workspace</span>
      <nav className="sidebar-links">{items.map(({ id, icon: Icon }) => <button key={id} onClick={() => navigate(id)} aria-current={currentTab === id ? 'page' : undefined} className={currentTab === id ? 'active' : ''}><Icon size={19} /><span>{navLabels[id]}</span>{currentTab === id && <span className="nav-dot" />}</button>)}</nav>
      {canAdmin && <><span className="eyebrow nav-caption">Settings</span><nav className="sidebar-links"><button className={currentTab === 'admin' ? 'active' : ''} aria-current={currentTab === 'admin' ? 'page' : undefined} onClick={() => navigate('admin')}><Settings size={19} /><span>Administration</span></button></nav></>}
      <div className="sidebar-bottom"><a href="mailto:mohamed.maseeh@sunsiyam.com"><span>Help & support</span><ArrowUpRight size={16} /></a><span className="sidebar-signature">Sun Diving</span></div>
    </aside>
  </>;
};
