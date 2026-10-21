import React from 'react';
import ReactDOM from 'react-dom/client';
import AppContent from './App';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { PropertyProvider } from './context/PropertyContext';
import './index.css';
import './workspace.css';
import { NavigationProvider } from './context/NavigationContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <PropertyProvider>
          <NavigationProvider><AppContent /></NavigationProvider>
        </PropertyProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
