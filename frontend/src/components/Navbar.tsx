import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useProperty } from '../context/PropertyContext';
import { useTheme } from '../context/ThemeContext';
import { Moon, Sun, LogOut, Building2, LockKeyhole, ChevronDown, Menu, ChevronRight } from 'lucide-react';
import { useNavigation } from '../context/NavigationContext';
import { NavTab, navLabels } from './SubNav';

export const Navbar: React.FC<{ currentTab: NavTab; onMenu: () => void; onSecurity: () => void }> = ({ currentTab, onMenu, onSecurity }) => {
  const { requestNavigation } = useNavigation();
  const { user, logout } = useAuth();
  const { activeProperty, properties, canSwitchProperty, setActiveProperty } = useProperty();
  const { theme, toggleTheme } = useTheme();
  const role = user?.role === 'GLOBAL_ADMIN' ? 'Global administrator' : user?.role === 'PROPERTY_MANAGER' ? 'Property manager' : 'Centre staff';
  return <header className="topbar">
    <div className="topbar-context"><button className="mobile-menu icon-button" onClick={onMenu} aria-label="Open navigation"><Menu size={21} /></button><Building2 className="property-icon" size={18} />
      <div className="property-select"><select aria-label="Active property" value={activeProperty?.id || ''} disabled={!canSwitchProperty || properties.length < 2} onChange={e => { const p = properties.find(p => p.id === e.target.value); if (p && p.id !== activeProperty?.id) requestNavigation(() => setActiveProperty(p)); }}>{!properties.length && <option value="">No property assigned</option>}{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{canSwitchProperty && properties.length > 1 ? <ChevronDown size={14} /> : <LockKeyhole size={13} />}</div>
      <ChevronRight size={14} className="breadcrumb-chevron" /><span className="breadcrumb">{navLabels[currentTab]}</span>
    </div>
    <div className="topbar-actions"><button onClick={onSecurity} className="icon-button" aria-label="Personal authenticator" title="Personal authenticator"><LockKeyhole size={19} /></button><button onClick={toggleTheme} className="icon-button" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title="Change theme">{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button><div className="profile-copy"><strong>{user?.name}</strong><span>{role}</span></div><span className="avatar" aria-hidden="true">{user?.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><button onClick={() => requestNavigation(logout)} className="icon-button" aria-label="Sign out" title="Sign out"><LogOut size={18} /></button></div>
  </header>;
};
