import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useProperty } from './context/PropertyContext';
import { Navbar } from './components/Navbar';
import { SubNav, NavTab } from './components/SubNav';
import { HomeDashboard } from './components/HomeDashboard';
import { NewBillView } from './components/NewBillView';
import { BillsView } from './components/BillsView';
import { PresenceView } from './components/PresenceView';
import { ReportingView } from './components/ReportingView';
import { AdminView } from './components/AdminView';
import { LoginView } from './components/LoginView';
import { Mail, Compass } from 'lucide-react';

export const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const { activeProperty, loading: propLoading } = useProperty();
  const [currentTab, setCurrentTab] = useState<NavTab>('home');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-teal-400 flex items-center justify-center animate-pulse">
          <Compass className="w-7 h-7 text-slate-950 stroke-[2.2]" />
        </div>
        <div className="text-sm font-semibold text-slate-400">Loading Dive Centre Manager...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Top Header Navbar */}
      <Navbar />

      {/* Secondary Menu (Home, New Bill, Bills, Presence, Reporting, Admin) */}
      <SubNav currentTab={currentTab} onTabChange={setCurrentTab} />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {currentTab === 'home' && (
          <HomeDashboard onNavigate={(tab) => setCurrentTab(tab)} />
        )}

        {currentTab === 'new-bill' && (
          <NewBillView onBillSaved={() => setCurrentTab('bills')} />
        )}

        {currentTab === 'bills' && <BillsView />}

        {currentTab === 'presence' && <PresenceView />}

        {currentTab === 'reporting' && <ReportingView />}

        {currentTab === 'admin' && <AdminView />}
      </main>

      {/* Footer matching PDF Page 8 */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-6 text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center space-x-2">
            <Compass className="w-4 h-4 text-sky-500" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Dive Centre Manager • {activeProperty?.name || 'Sun Diving'}
            </span>
          </div>

          <div className="flex items-center space-x-1">
            <span>Need help? Email support at</span>
            <a
              href="mailto:dive@devsabah.net"
              className="font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center space-x-0.5 ml-1"
            >
              <Mail className="w-3 h-3 inline mr-0.5" />
              <span>dive@devsabah.net</span>
            </a>
          </div>

          <div className="text-[11px] text-slate-400">
            Centre Staff Manual • v1.0 • Multi-Property Edition
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AppContent;
