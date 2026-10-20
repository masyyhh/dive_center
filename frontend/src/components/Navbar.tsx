import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useProperty } from '../context/PropertyContext';
import { useTheme } from '../context/ThemeContext';
import { Compass, Moon, Sun, LogOut, Building, Shield, Lock, ChevronDown } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { activeProperty, properties, canSwitchProperty, setActiveProperty } = useProperty();
  const { theme, toggleTheme } = useTheme();

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'GLOBAL_ADMIN':
        return { label: 'GLOBAL ADMIN', color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20' };
      case 'PROPERTY_MANAGER':
        return { label: 'BASE MANAGER', color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20' };
      default:
        return { label: 'CENTRE STAFF', color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/20' };
    }
  };

  const roleBadge = getRoleBadge(user?.role);

  return (
    <header className="bg-slate-900 text-slate-100 border-b border-slate-800 sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Active Centre */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-teal-400 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Compass className="w-6 h-6 text-slate-950 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-extrabold tracking-widest text-sky-400 uppercase">
                  Dive Centre Manager
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${roleBadge.color}`}>
                  {roleBadge.label}
                </span>
              </div>
              <div className="text-sm font-bold text-white flex items-center space-x-2">
                <span>{activeProperty?.name || 'Sun Diving'}</span>
                {!canSwitchProperty && (
                  <span className="inline-flex items-center text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full" title="Centre switcher is disabled for your account">
                    <Lock className="w-2.5 h-2.5 mr-1 text-slate-400" />
                    Fixed Centre
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Property Switcher for Admin / Manager */}
          {canSwitchProperty && properties.length > 1 && (
            <div className="relative ml-4">
              <select
                value={activeProperty?.id || ''}
                onChange={(e) => {
                  const p = properties.find((item) => item.id === e.target.value);
                  if (p) setActiveProperty(p);
                }}
                className="bg-slate-800 hover:bg-slate-700/80 text-xs font-medium text-slate-200 border border-slate-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer transition appearance-none pr-8"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
        </div>

        {/* User profile, Theme Toggle & Sign out */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          <div className="hidden sm:block text-right">
            <div className="text-sm font-semibold text-slate-100">{user?.name}</div>
            <div className="text-xs text-slate-400">{user?.email}</div>
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-sky-400" />}
          </button>

          {/* Sign out */}
          <button
            onClick={logout}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-300 hover:text-rose-100 hover:bg-rose-500/20 border border-rose-500/30 transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
