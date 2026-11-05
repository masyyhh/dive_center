import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useProperty } from '../context/PropertyContext';
import { useTheme } from '../context/ThemeContext';
import { Moon, Sun, LogOut, Building2, LockKeyhole, ChevronDown, Menu, ChevronRight, Loader2, Keyboard } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { NavTab, navLabels } from './SubNav';
import { isSiyamWorld } from '../utils/propertyPresentation';

export const Navbar: React.FC<{
  currentTab: NavTab;
  onMenu: () => void;
  onSecurity: () => void;
  onShortcuts: () => void;
}> = ({ currentTab, onMenu, onSecurity, onShortcuts }) => {
  const { requestNavigation } = useNavigation();
  const { user, logout, signingOut, logoutError } = useAuth();
  const { activeProperty, properties, canSwitchProperty, setActiveProperty } = useProperty();
  const { theme, toggleTheme } = useTheme();
  const siyamWorld = isSiyamWorld(activeProperty);

  const role =
    user?.role === 'GLOBAL_ADMIN' ? 'Global administrator' :
      user?.role === 'PROPERTY_MANAGER' ? 'Property manager' :
        'Centre staff';

  return (
    <header className="topbar flex items-center justify-between px-4 py-3 border-b bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 transition-colors">
      {/* Left Context & Breadcrumbs */}
      <div className="topbar-context flex items-center gap-3">
        <button
          className="mobile-menu icon-button p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          onClick={onMenu}
          aria-label="Open navigation"
        >
          <Menu size={20} className="text-gray-600 dark:text-gray-300" />
        </button>

        <div className="flex items-center gap-2">
          <Building2 className="property-icon text-indigo-600 dark:text-indigo-400" size={18} />
          <div className="property-select relative flex items-center">
            <select
              aria-label="Active property"
              value={activeProperty?.id || ''}
              disabled={!canSwitchProperty || properties.length < 2}
              onChange={e => {
                const p = properties.find(prop => prop.id === e.target.value);
                if (p && p.id !== activeProperty?.id) {
                  requestNavigation(() => setActiveProperty(p));
                }
              }}
              className="appearance-none bg-transparent font-medium text-sm text-gray-800 dark:text-gray-200 pr-6 pl-1 py-1 rounded cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-75 disabled:cursor-not-allowed"
            >
              {!properties.length && <option value="">No property assigned</option>}
              {properties.map(p => (
                <option key={p.id} value={p.id} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                  {p.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-1 text-gray-500 dark:text-gray-400">
              {canSwitchProperty && properties.length > 1 ? (
                <ChevronDown size={14} />
              ) : (
                <LockKeyhole size={13} />
              )}
            </div>
          </div>
        </div>

        <ChevronRight size={14} className="breadcrumb-chevron text-gray-400 dark:text-gray-600" />
        <span className="breadcrumb text-sm font-semibold text-gray-700 dark:text-gray-200">
          {navLabels[currentTab]}
        </span>
      </div>

      {/* Right Actions & User Profile */}
      <div className="topbar-actions flex items-center gap-2 sm:gap-3">
        {siyamWorld && currentTab === 'new-bill' && <div id="bill-header-actions" />}
        {logoutError && (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400 font-medium px-2">
            {logoutError}
          </span>
        )}

        {/* Workspace actions */}
        <div className="flex items-center gap-1 border-r border-gray-200 dark:border-gray-800 pr-2 sm:pr-3">
          {!siyamWorld && <>
            <button type="button" onClick={onShortcuts} className="icon-button shortcuts-trigger" aria-label="Keyboard shortcuts" aria-keyshortcuts="Alt+Shift+K" title="Keyboard shortcuts (Alt + Shift + K)"><Keyboard size={18} /></button>
            <button type="button" onClick={onSecurity} className="icon-button" aria-label={import.meta.env.VITE_DEPLOYMENT_MODE === 'testing' ? 'Manage authenticator in live version' : 'Personal authenticator'} title={import.meta.env.VITE_DEPLOYMENT_MODE === 'testing' ? 'Manage authenticator in live version' : 'Personal authenticator'}><LockKeyhole size={18} /></button>
          </>}
          <button
            onClick={toggleTheme}
            className="icon-button p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title="Change theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* User Profile Info */}
        <div className="flex items-center gap-3 pl-1">
          {!siyamWorld && <><div className="profile-copy hidden md:flex flex-col text-right">
            <strong className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight">
              {user?.name}
            </strong>
            <span className="text-xs text-gray-500 dark:text-gray-400 leading-tight mt-0.5">
              {role}
            </span>
          </div>

          <span
            className="avatar flex items-center justify-center w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-xs tracking-wider shadow-inner"
            aria-hidden="true"
          >
            {user?.name?.split(' ').map(n => n[0]).slice(0, 2).join('')}
          </span></>}

          <button
            disabled={signingOut}
            onClick={() => requestNavigation(() => { void logout(); })}
            className="icon-button p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors disabled:opacity-50"
            aria-label="Sign out"
            title="Sign out"
          >
            {signingOut ? <Loader2 size={18} className="animate-spin text-red-500" /> : <LogOut size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
};
