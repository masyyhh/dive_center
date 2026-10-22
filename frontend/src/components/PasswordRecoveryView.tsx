import React, { useState } from 'react';
import { apiFetch } from '../services/api';

export const passwordHelp = 'At least 12 characters, including uppercase and lowercase letters, a number, and a symbol. No spaces.';
export const passwordPattern = '(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9\\s])\\S{12,}';

export const PasswordRecoveryView: React.FC<{ initialToken?: string; onDone: (message?: string) => void }> = ({ initialToken, onDone }) => {
  const [step, setStep] = useState<'verify' | 'password'>(initialToken ? 'password' : 'verify');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const post = <T,>(path: string, body: unknown, headers?: Record<string, string>) => apiFetch<T>(`/auth/${path}`, { method: 'POST', body: JSON.stringify(body), headers });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try {
      if (step === 'verify') {
        const result = await post<{ resetToken: string }>('password-reset/verify', { username, code });
        setResetToken(result.resetToken); setCode(''); setStep('password');
      } else {
        if (password !== confirmation) throw new Error('Passwords do not match.');
        const result = initialToken
          ? await post<{ message: string }>('initial-password', { password }, { Authorization: `Bearer ${initialToken}` })
          : await post<{ message: string }>('password-reset/complete', { resetToken, password });
        setPassword(''); setConfirmation(''); setResetToken(''); onDone(result.message);
      }
    } catch (err: any) { setError(err.message || 'Unable to complete this step. Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="signin-page"><main className="signin-card" aria-labelledby="password-heading">
    <img className="signin-mark" src={`${import.meta.env.BASE_URL}logo.png`} alt="Dive Centre logo" width={297} height={170} />
    <p className="signin-brand">DIVE CENTRE MANAGER</p>
    <h1 id="password-heading">{initialToken ? 'Change your initial password' : step === 'verify' ? 'Reset your password' : 'Create a new password'}</h1>
    <p className="signin-intro">{initialToken ? 'Create your own password before entering your workspace.' : step === 'verify' ? 'Enter your username and a code from the authenticator bound to your account, or one of your saved recovery codes.' : 'Your code is verified. Create your new password within 10 minutes.'}</p>
    {error && <p className="signin-error" role="alert">{error}</p>}
    <form className="signin-form" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '1rem' }}>
        {step === 'verify' && <>
          <div className="signin-field"><label htmlFor="reset-username">Username</label><input id="reset-username" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value.trim())} /></div>
          <div className="signin-field"><label htmlFor="reset-code">Authenticator or recovery code</label><input id="reset-code" autoComplete="one-time-code" minLength={6} maxLength={32} required value={code} onChange={e => setCode(e.target.value)} /></div>
          <p className="signin-help">Wait for a new code if you just used one. If you have not bound an authenticator, or lost your device and recovery codes, contact your property manager or global administrator.</p>
        </>}
        {step === 'password' && <>
          <p id="password-rules" className="signin-help">{passwordHelp}</p>
          <div className="signin-field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" aria-describedby="password-rules" required minLength={12} pattern={passwordPattern} title={passwordHelp} value={password} onChange={e => setPassword(e.target.value)} /></div>
          <div className="signin-field"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>
        </>}
        <button className="signin-submit" type="submit">{busy ? 'Please wait…' : step === 'verify' ? 'Verify code' : 'Save new password'}</button>
      </fieldset>
    </form>
    {!initialToken && step === 'password' && <button type="button" className="signin-help" disabled={busy} onClick={() => { setStep('verify'); setResetToken(''); setPassword(''); setConfirmation(''); setError(''); }}>Verify another code</button>}
    <button type="button" className="signin-help" disabled={busy} onClick={() => onDone()}>Back to sign in</button>
  </main></div>;
};
