import { AuthenticatorSetupView } from './components/AuthenticatorSetupView';
import { Modal } from './components/Modal';
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useProperty } from './context/PropertyContext';
import { Navbar } from './components/Navbar';
import { SubNav, NavTab, navLabels } from './components/SubNav';
import { waterSportsEnabled } from './features';
const WaterSportsView = waterSportsEnabled
  ? lazy(() => import('./components/WaterSportsView').then(module => ({ default: module.WaterSportsView })))
  : () => null;
const HomeDashboard = lazy(() => import('./components/HomeDashboard').then(module => ({ default: module.HomeDashboard })));
const NewBillView = lazy(() => import('./components/NewBillView').then(module => ({ default: module.NewBillView })));
const BillsView = lazy(() => import('./components/BillsView').then(module => ({ default: module.BillsView })));
const PresenceView = lazy(() => import('./components/PresenceView').then(module => ({ default: module.PresenceView })));
const ReportingView = lazy(() => import('./components/ReportingView').then(module => ({ default: module.ReportingView })));
const AdminView = lazy(() => import('./components/AdminView').then(module => ({ default: module.AdminView })));
import { LoginView } from './components/LoginView';
import { useNavigation } from './context/NavigationContext';
import { Waves } from 'lucide-react';

const validTabs = Object.keys(navLabels).filter(tab => tab !== 'water-sports' || waterSportsEnabled);
const readTab = (): NavTab => validTabs.includes(location.hash.slice(1).split('/')[0]) ? location.hash.slice(1).split('/')[0] as NavTab : 'home';
const readSection = () => location.hash.slice(1).split('/')[1] || '';
export const AppContent: React.FC = () => {
  const { user, loading, refreshUser } = useAuth();
  const { activeProperty, loading: propertyLoading } = useProperty();
  const [currentTab, setCurrentTab] = useState<NavTab>(readTab);
  const [section, setSection] = useState(readSection);
  const { requestNavigation, hasUnsavedChanges } = useNavigation();
  const currentRoute = useRef(location.hash || '#home');
  const routeIndex = useRef<number>(window.history.state?.dcmRouteIndex ?? 0);
  const restoringPop = useRef<{ index: number; delta: number } | null>(null);
  const allowedPop = useRef<number | null>(null);
  const [savedBill, setSavedBill] = useState<number | null>(null);
  useEffect(() => setSavedBill(null), [user?.id, activeProperty?.id]);
  const [securityCodesVisible, setSecurityCodesVisible] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const canAdmin = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const commitRoute = (tab: NavTab, nextSection = '', replace = false) => {
    const route = `#${tab}${nextSection ? `/${nextSection}` : ''}`;
    if (location.hash !== route) {
      if (!replace) routeIndex.current++;
      window.history[replace ? 'replaceState' : 'pushState']({ dcmRouteIndex: routeIndex.current }, '', route);
    }
    currentRoute.current = route;
    setCurrentTab(tab); setSection(nextSection); setMenuOpen(false);
  };
  const navigate = (tab: NavTab, nextSection = '') => {
    if (currentRoute.current === `#${tab}${nextSection ? `/${nextSection}` : ''}`) return;
    requestNavigation(() => commitRoute(tab, nextSection));
  };
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, dcmRouteIndex: routeIndex.current }, '', currentRoute.current);
    const adoptLocation = (index: number) => {
      routeIndex.current = index; currentRoute.current = location.hash;
      setCurrentTab(readTab()); setSection(readSection()); setMenuOpen(false);
    };
    const onExternalHash = () => {
      if (location.hash === currentRoute.current || restoringPop.current || allowedPop.current !== null) return;
      const tab = readTab(), nextSection = readSection();
      window.history.replaceState({ dcmRouteIndex: routeIndex.current }, '', currentRoute.current);
      requestNavigation(() => commitRoute(tab, nextSection, true));
    };
    const onPop = (event: PopStateEvent) => {
      const index = event.state?.dcmRouteIndex;
      if (restoringPop.current) {
        const pending = restoringPop.current; restoringPop.current = null;
        requestNavigation(() => { allowedPop.current = pending.index; window.history.go(pending.delta); });
        return;
      }
      if (typeof index !== 'number') { onExternalHash(); return; }
      if (allowedPop.current === index || !hasUnsavedChanges()) {
        allowedPop.current = null; adoptLocation(index); return;
      }
      const delta = index - routeIndex.current;
      if (!delta) { onExternalHash(); return; }
      // Restore the current history entry before showing the warning, so cancelling
      // preserves both the screen and the browser's Back/Forward destinations.
      restoringPop.current = { index, delta };
      window.history.go(-delta);
    };
    window.addEventListener('hashchange', onExternalHash);
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('hashchange', onExternalHash); window.removeEventListener('popstate', onPop); };
  }, [requestNavigation, hasUnsavedChanges]);
  useEffect(() => { document.title = `${user ? navLabels[currentTab] : 'Sign in'} · Dive Centre Manager`; mainRef.current?.focus(); }, [currentTab, user]);
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  if (loading) return <div className="app-loading" role="status"><Waves size={32} /><span>Opening your workspace…</span></div>;
  if (!user) return <LoginView />;
  if (!user.authenticatorEnabled) return <div className="signin-page"><AuthenticatorSetupView onComplete={() => { void refreshUser(); }} /></div>;
  return <div className="app-shell">
    {securityOpen && <Modal label="Personal authenticator" busy={securityCodesVisible} onClose={() => { if (!securityCodesVisible) setSecurityOpen(false); }}><AuthenticatorSetupView onCodesVisible={setSecurityCodesVisible} onCancel={() => setSecurityOpen(false)} onComplete={() => { setSecurityOpen(false); void refreshUser(); }} /></Modal>}
    <a href="#main-content" className="skip-link" onClick={e => { e.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
    <SubNav currentTab={currentTab} onTabChange={navigate} open={menuOpen} onClose={() => setMenuOpen(false)} />
    <div className="workspace"><Navbar currentTab={currentTab} onMenu={() => setMenuOpen(true)} onSecurity={() => requestNavigation(() => setSecurityOpen(true))} />
      <main id="main-content" className={`main-content view-${currentTab}`} ref={mainRef} tabIndex={-1}>
        {propertyLoading ? <div className="app-loading" role="status">Loading your property…</div> : !activeProperty && currentTab !== 'admin' ? <div className="empty-state"><BuildingNotice /><h1>No property assigned</h1><p>Contact your administrator to get access to a dive centre.</p>{canAdmin && <button className="primary-button" onClick={() => navigate('admin')}>Manage properties</button>}</div> : <Suspense key={`${user.id}-${activeProperty?.id}`} fallback={<div className="app-loading" role="status">Opening {navLabels[currentTab].toLowerCase()}…</div>}>
          {waterSportsEnabled && currentTab === 'water-sports' && <WaterSportsView />}
          {currentTab === 'home' && <HomeDashboard onNavigate={navigate} />}
          {currentTab === 'new-bill' && <><div className="page-heading"><span className="eyebrow">FRONT DESK</span><h1>Create a bill</h1><p>Add activities, assign your guest, and review the total before saving.</p></div><NewBillView onSetup={() => navigate('admin', 'items')} onBillSaved={check => { setSavedBill(check); commitRoute('bills'); }} /></>}
          {currentTab === 'bills' && <BillsView savedCheck={savedBill} onDismissSaved={() => setSavedBill(null)} />}
          {currentTab === 'presence' && <PresenceView initialDate={section} onSetup={() => navigate('admin', 'staff')} onPayroll={() => navigate('reporting', 'exports')} />}
          {currentTab === 'reporting' && <ReportingView section={section} onSectionChange={value => navigate('reporting', value)} />}
          {currentTab === 'admin' && (canAdmin ? <AdminView section={section} onSectionChange={value => navigate('admin', value)} /> : <div className="empty-state"><h1>Administrator access required</h1><p>Contact your property manager for help with workspace settings.</p></div>)}
        </Suspense>}
      </main>

    </div>
  </div>;
};
const BuildingNotice = () => <Waves size={28} />;
export default AppContent;
