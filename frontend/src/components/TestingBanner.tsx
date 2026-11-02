import React from 'react';
import { useNavigation } from '../context/NavigationContext';

export const TestingBanner: React.FC = () => {
  const { requestNavigation } = useNavigation();
  const independentTesting = document.documentElement.dataset.appEnvironment === 'testing';
  if (independentTesting) return <aside className="testing-banner" aria-label="Independent testing environment"><div><strong>TESTING ONLY</strong><span>Separate testing database and accounts. Changes here do not affect production.</span></div></aside>;
  if (import.meta.env.VITE_DEPLOYMENT_MODE !== 'testing') return null;
  return <aside className="testing-banner" aria-label="Testing version">
    <div><strong>Testing version</strong><span>Separate test database. Bills and payments here do not affect live records.</span></div>
    <a href="/" onClick={event => { event.preventDefault(); requestNavigation(() => window.location.assign('/')); }}>Return to live version</a>
  </aside>;
};
