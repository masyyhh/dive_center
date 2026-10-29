import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import AppContent from './App';
import { waterSportsEnabled } from './features';
const WaterSportsTablet = waterSportsEnabled
  ? lazy(() => import('./components/WaterSportsTablet').then(module => ({ default: module.WaterSportsTablet })))
  : (_props: { token: string }) => null;
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { PropertyProvider } from './context/PropertyContext';
import './index.css';
import './workspace.css';
import { NavigationProvider } from './context/NavigationContext';

const tabletToken = waterSportsEnabled ? location.hash.match(/^#water-sports-tablet\/([a-f0-9]{64})$/)?.[1] : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      {tabletToken ? <Suspense fallback={<div role="status">Opening form…</div>}><WaterSportsTablet token={tabletToken} /></Suspense> : <AuthProvider>
        <PropertyProvider>
          <NavigationProvider><AppContent /></NavigationProvider>
        </PropertyProvider>
      </AuthProvider>}
    </ThemeProvider>
  </React.StrictMode>
);
