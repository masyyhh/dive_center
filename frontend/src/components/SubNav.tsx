import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useProperty } from '../context/PropertyContext';
import { isSiyamWorld } from '../utils/propertyPresentation';
import { waterSportsEnabled } from '../features';
import { LayoutDashboard, Plus, Receipt, CalendarCheck, BarChart3, Settings, Waves, ArrowUpRight, X, Keyboard, ArrowLeft } from 'lucide-react';

export type NavTab = 'home' | 'new-bill' | 'bills' | 'presence' | 'reporting' | 'admin' | 'dive-centre';
export const navLabels: Record<NavTab, string> = { home: 'Overview', 'dive-centre': 'Disclaimer', 'new-bill': 'New bill', bills: 'Bills', presence: 'Attendance', reporting: 'Reports & payroll', admin: 'Administration' };
interface SubNavProps { currentTab: NavTab; onTabChange: (tab: NavTab) => void; open: boolean; onClose: () => void; onShortcuts: () => void; catalogue?: { width: number; onResize: (width: number) => void }; }

export const SubNav: React.FC<SubNavProps> = ({ currentTab, onTabChange, open, onClose, onShortcuts, catalogue }) => {
  const sidebarRef = useRef<HTMLElement>(null);
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const resize = (width: number) => catalogue?.onResize(Math.min(480, Math.max(220, width)));
  useEffect(() => {
    if (!open) return;
    const sidebar = sidebarRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const workspace = document.querySelector<HTMLElement>('.workspace');
    if (workspace) workspace.inert = true;
    sidebar?.querySelector<HTMLElement>('.sidebar-close')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex="0"]') || []).filter(el => el.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (workspace) workspace.inert = false; previous?.focus(); };
  }, [open]);
  const { user } = useAuth();
  const { activeProperty } = useProperty();
  const siyamWorld = isSiyamWorld(activeProperty);
  const canAdmin = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const items = [
    { id: 'home' as NavTab, icon: LayoutDashboard }, { id: 'bills' as NavTab, icon: Receipt },
    ...(waterSportsEnabled ? [{ id: 'dive-centre' as NavTab, icon: Waves }] : []),
    { id: 'presence' as NavTab, icon: CalendarCheck }, { id: 'reporting' as NavTab, icon: BarChart3 },
  ];
  const navigate = (tab: NavTab) => { onTabChange(tab); onClose(); };
  const administration = canAdmin && <nav className="sidebar-links" aria-label="Administration"><button className={currentTab === 'admin' ? 'active' : ''} aria-current={currentTab === 'admin' ? 'page' : undefined} onClick={() => navigate('admin')}><Settings size={19} /><span>Administration</span></button></nav>;
  return <>
    {open && <button className="sidebar-scrim" aria-label={catalogue ? 'Close catalogue' : 'Close navigation'} onClick={onClose} />}
    <aside ref={sidebarRef} className={`sidebar ${open ? 'is-open' : ''}${catalogue ? ' catalogue-sidebar' : ''}`} aria-label={catalogue ? 'Activity catalogue' : 'Workspace navigation'}>
      {catalogue ? <>
        <div className="catalogue-sidebar-heading"><button type="button" className="text-button" onClick={() => navigate('home')}><ArrowLeft size={16} />Workspace</button><h2>Catalogue</h2></div>
        <button className="sidebar-close icon-button" aria-label="Close catalogue" onClick={onClose}><X size={20} /></button>
        <div id="bill-catalogue-sidebar" className="catalogue-sidebar-content" />
        <div role="separator" aria-label="Resize catalogue" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={480} aria-valuenow={catalogue.width} tabIndex={0} className="catalogue-resize-handle"
          onPointerDown={event => { if (event.button !== 0) return; dragStart.current = { x: event.clientX, width: catalogue.width }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
          onPointerMove={event => { if (dragStart.current && event.currentTarget.hasPointerCapture(event.pointerId)) resize(dragStart.current.width + event.clientX - dragStart.current.x); }}
          onPointerUp={event => { dragStart.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { dragStart.current = null; }} onLostPointerCapture={() => { dragStart.current = null; }}
          onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); resize(event.key === 'Home' ? 220 : event.key === 'End' ? 480 : catalogue.width + (event.key === 'ArrowLeft' ? -20 : 20)); } }}
          onDoubleClick={() => resize(280)} />
      </> : <>
      <a className="brand" href="#home" onClick={event => { event.preventDefault(); navigate('home'); }}><img className="brand-symbol" src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={297} height={170} /><span>Dive Centre<span className="brand-subtitle">Workspace</span></span></a>
      <button className="sidebar-close icon-button" aria-label="Close navigation" onClick={onClose}><X size={20} /></button>
      <button className={`sidebar-create ${currentTab === 'new-bill' ? 'selected' : ''}`} aria-current={currentTab === 'new-bill' ? 'page' : undefined} onClick={() => navigate('new-bill')}><Plus size={18} />New bill</button>
      <span className="eyebrow nav-caption">Workspace</span>
      <nav className="sidebar-links">{items.map(({ id, icon: Icon }) => <button key={id} onClick={() => navigate(id)} aria-current={currentTab === id ? 'page' : undefined} className={currentTab === id ? 'active' : ''}><Icon size={19} /><span>{navLabels[id]}</span>{currentTab === id && <span className="nav-dot" />}</button>)}</nav>
      {!siyamWorld && canAdmin && <><span className="eyebrow nav-caption">Settings</span>{administration}</>}
      {siyamWorld ? canAdmin && <div className="sidebar-bottom">{administration}</div> : <div className="sidebar-bottom"><button type="button" className="sidebar-shortcuts" onClick={() => { onClose(); onShortcuts(); }}><Keyboard size={16} /><span>Keyboard shortcuts</span></button><a href="mailto:mohamed.maseeh@sunsiyam.com"><span>Help & support</span><ArrowUpRight size={16} /></a><span className="sidebar-signature">Sun Diving</span></div>}
      </>}
    </aside>
  </>;
};
