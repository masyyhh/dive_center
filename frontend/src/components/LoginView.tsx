import { PasswordRecoveryView } from './PasswordRecoveryView';
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [initialToken, setInitialToken] = useState<string>();
  const [message, setMessage] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      if (result.changeToken) { setInitialToken(result.changeToken); setPassword(''); }
      if (!result.success) setError(result.error || 'Unable to sign in. Please try again.');
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (recovery || initialToken) return <PasswordRecoveryView initialToken={initialToken} onDone={message => { setRecovery(false); setInitialToken(undefined); setMessage(message || ''); setError(''); setPassword(''); }} />;

  return (
    <div className="signin-page">
      <button
        type="button"
        className="signin-theme"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <main className="signin-card" aria-labelledby="signin-heading">
        <img className="signin-mark" src={`${import.meta.env.BASE_URL}logo.png`} alt="Dive Centre logo" width={297} height={170} />
        <p className="signin-brand">DIVE CENTRE MANAGER</p>
        <h1 id="signin-heading">Welcome back</h1>
        <p className="signin-intro">Sign in with your unique username and password. Existing email-shaped sign-in IDs still work.</p>

        {message && <p className="signin-help" role="status">{message}</p>}
        {error && <p className="signin-error" role="alert">{error}</p>}

        <form className="signin-form" onSubmit={handleSubmit} aria-busy={loading}>
          <div className="signin-field">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={event => setUsername(event.target.value)}
            />
          </div>
          <div className="signin-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </div>
          <button className="signin-submit" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <button type="button" className="signin-help" onClick={() => { setRecovery(true); setError(''); setPassword(''); }}>Forgot your password?</button>
      </main>
    </div>
  );
};
