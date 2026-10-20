import React from 'react';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, PlusCircle, Receipt, CalendarCheck, BarChart3, Settings } from 'lucide-react';

export type NavTab = 'home' | 'new-bill' | 'bills' | 'presence' | 'reporting' | 'admin';

interface SubNavProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

export const SubNav: React.FC<SubNavProps> = ({ currentTab, onTabChange }) => {
  const { user } = useAuth();
  const canAccessAdmin = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';

  const navItems = [
    { id: 'home' as NavTab, label: 'Home', icon: LayoutDashboard },
    { id: 'new-bill' as NavTab, label: 'New Bill', icon: PlusCircle },
    { id: 'bills' as NavTab, label: 'Bills', icon: Receipt },
    { id: 'presence' as NavTab, label: 'Presence', icon: CalendarCheck },
    { id: 'reporting' as NavTab, label: 'Reporting', icon: BarChart3 },
    ...(canAccessAdmin ? [{ id: 'admin' as NavTab, label: 'Admin', icon: Settings }] : []),
  ];

  return (
    <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm sticky top-16 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-1 sm:space-x-4 overflow-x-auto py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                  isActive
                    ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/80 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400 dark:text-slate-500'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
