import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import AppContent from './App';
import { waterSportsEnabled } from './features';
import { guestTokenFromHash } from './utils/diveCentreJourney';
const DiveCentreTablet = waterSportsEnabled
  ? lazy(() => import('./components/WaterSportsTablet').then(module => ({ default: module.DiveCentreTablet })))
  : (_props: { token: string }) => null;
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { PropertyProvider } from './context/PropertyContext';
import './index.css';
import './workspace.css';
import { TestingBanner } from './components/TestingBanner';
import { NavigationProvider } from './context/NavigationContext';

if (document.documentElement.dataset.appEnvironment === 'testing') document.title = 'TESTING Dive Centre Manager';

const tabletToken = waterSportsEnabled ? guestTokenFromHash(location.hash) : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <NavigationProvider><TestingBanner />
      {tabletToken ? <Suspense fallback={<div role="status">Opening form…</div>}><DiveCentreTablet token={tabletToken} /></Suspense> : <AuthProvider>
        <PropertyProvider>
          <AppContent />
        </PropertyProvider>
      </AuthProvider>}
      </NavigationProvider>
    </ThemeProvider>
  </React.StrictMode>
);
