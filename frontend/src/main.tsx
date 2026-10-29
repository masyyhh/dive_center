import React from 'react';
import ReactDOM from 'react-dom/client';
import AppContent from './App';
import { WaterSportsTablet } from './components/WaterSportsTablet';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { PropertyProvider } from './context/PropertyContext';
import './index.css';
import './workspace.css';
import { NavigationProvider } from './context/NavigationContext';

const tabletToken = location.hash.match(/^#water-sports-tablet\/([a-f0-9]{64})$/)?.[1];

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      {tabletToken ? <WaterSportsTablet token={tabletToken} /> : <AuthProvider>
        <PropertyProvider>
          <NavigationProvider><AppContent /></NavigationProvider>
        </PropertyProvider>
      </AuthProvider>}
    </ThemeProvider>
  </React.StrictMode>
);
