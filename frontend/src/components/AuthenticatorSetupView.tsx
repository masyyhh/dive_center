import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from '../context/AuthContext';

export const AuthenticatorSetupView: React.FC<{ onComplete: () => void; onCancel?: () => void; onCodesVisible?: (visible: boolean) => void }> = ({ onComplete, onCancel, onCodesVisible }) => {
  const { user, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [otp, setOtp] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qrCode: string }>();
  const [codes, setCodes] = useState<string[]>([]);
  useEffect(() => { onCodesVisible?.(codes.length > 0); return () => onCodesVisible?.(false); }, [codes.length, onCodesVisible]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const post = <T,>(path: string, body: unknown) => apiFetch<T>(`/auth/authenticator/${path}`, { method: 'POST', body: JSON.stringify(body) });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try {
      if (!setup) {
        const result = await post<{ secret: string; qrCode: string }>('setup', { password, ...(currentCode ? { code: currentCode } : {}) });
        setSetup(result); setPassword(''); setCurrentCode('');
      } else {
        const result = await post<{ recoveryCodes: string[] }>('confirm', { otp });
        setCodes(result.recoveryCodes); setSetup(undefined); setOtp('');
      }
    } catch (err: any) { setError(err.message || 'Unable to set up your authenticator.'); }
    finally { setBusy(false); }
  };
  const downloadCodes = () => {
    const text = `Dive Centre Manager recovery codes\nUsername: ${user?.username}\nEach code can be used once. Keep these private and separate from your phone.\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = 'dive-centre-recovery-codes.txt'; link.click(); URL.revokeObjectURL(url);
  };
  return <main className="signin-card authenticator-card" aria-labelledby="authenticator-heading">
    <p className="signin-brand">DIVE CENTRE MANAGER · {user?.username}</p>
    <h1 id="authenticator-heading">{codes.length ? 'Save your recovery codes' : user?.authenticatorEnabled ? 'Replace your authenticator' : 'Bind your authenticator'}</h1>
    <p className="signin-intro">{codes.length ? 'These codes are shown once. Each can recover your account if you lose your device. Store them somewhere private, away from your phone.' : setup ? 'Scan this QR code in your authenticator app, or enter the setup key manually. Enter a code from the app within 10 minutes to finish.' : 'Connect your own authenticator app to this account for password recovery. No email or shared mailbox is needed.'}</p>
    {error && <p className="signin-error" role="alert">{error}</p>}
    {codes.length > 0 ? <div className="signin-form">
      <ul className="recovery-code-list" aria-label="One-time recovery codes">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
      <button type="button" className="secondary-button" onClick={downloadCodes}>Download recovery codes</button>
      <label><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I saved my recovery codes in a private place.</label>
      <button type="button" className="signin-submit" disabled={!saved} onClick={() => { setCodes([]); onComplete(); }}>Continue to workspace</button>
    </div> : <form className="signin-form" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '1rem' }}>
        {!setup ? <>
          <div className="signin-field"><label htmlFor="auth-current-password">Current password</label><input id="auth-current-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
          {user?.authenticatorEnabled && <div className="signin-field"><label htmlFor="auth-current-code">Current authenticator or recovery code</label><input id="auth-current-code" autoComplete="off" required maxLength={32} value={currentCode} onChange={e => setCurrentCode(e.target.value)} /></div>}
          {user?.authenticatorEnabled && <p className="signin-help">Your current authenticator stays active until you confirm the replacement. Confirmation replaces your old authenticator and recovery codes.</p>}
        </> : <>
          <img src={setup.qrCode} alt="Scan this QR code with your authenticator app" width={240} height={240} style={{ margin: 'auto', maxWidth: '100%' }} />
          <div className="signin-field"><label htmlFor="auth-setup-key">Manual setup key</label><input id="auth-setup-key" value={setup.secret} readOnly autoComplete="off" spellCheck={false} /></div>
          <p className="signin-help">Use a time-based account with 6 digits and a 30-second interval.</p>
          <div className="signin-field"><label htmlFor="auth-setup-code">Authenticator code</label><input id="auth-setup-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={otp} onChange={e => setOtp(e.target.value)} /></div>
        </>}
        <button className="signin-submit" type="submit">{busy ? 'Please wait…' : setup ? 'Confirm authenticator' : 'Start authenticator setup'}</button>
      </fieldset>
      {setup && <button type="button" className="signin-help" disabled={busy} onClick={() => { setSetup(undefined); setOtp(''); setError(''); }}>Restart setup</button>}
    </form>}
    {!codes.length && <button type="button" className="signin-help" disabled={busy} onClick={onCancel || logout}>{onCancel ? 'Cancel' : 'Sign out'}</button>}
  </main>;
};
