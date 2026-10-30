import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const TestingLoginView: React.FC = () => {
  const { connectLive } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async () => {
    setBusy(true); setError('');
    try { await connectLive(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not connect your live sign-in.'); }
    finally { setBusy(false); }
  };
  return <main className="testing-login surface" aria-labelledby="testing-login-heading">
    <h1 id="testing-login-heading">Use your live account for testing</h1>
    <p>Your existing live sign-in and authenticator setup are used. Only selected users can enter; no new authenticator setup is needed.</p>
    <ol><li><a href="/" target="_blank" rel="noopener noreferrer">Sign in to the live version</a> in another tab, if you have not already.</li><li>Return here and connect your live sign-in.</li></ol>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="primary-button" disabled={busy} onClick={connect}>{busy ? 'Checking access…' : 'Connect live sign-in'}</button>
    <p className="text-sm">Bills, staff and payroll remain in the separate testing database. Signing out here leaves your live session signed in.</p>
  </main>;
};
