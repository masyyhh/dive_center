import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Compass, Lock, Mail, AlertCircle, ShieldCheck, Sun, Moon } from 'lucide-react';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    const res = await login(email.trim(), password);
    if (!res.success) {
      setErrorMsg(res.error || 'Invalid credentials.');
    }
    setLoading(false);
  };

  const fillCredentials = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 text-slate-100 relative overflow-hidden font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Theme toggle in top right */}
      <button
        onClick={toggleTheme}
        className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
      >
        {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-sky-400" />}
      </button>

      <div className="max-w-md w-full space-y-6 relative z-10">
        {/* Brand Banner */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-500 to-teal-400 items-center justify-center shadow-xl shadow-sky-500/30 mb-2">
            <Compass className="w-8 h-8 text-slate-950 stroke-[2.2]" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            DIVE CENTRE MANAGER
          </h1>
          <p className="text-xs text-slate-400">
            Multi-property operations, bills, attendance & commission
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900/90 backdrop-blur-md p-7 rounded-3xl border border-slate-800 shadow-2xl space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
              <div className="space-y-0.5">
                <span className="font-semibold block">Authentication Notice</span>
                <span className="text-[11px] leading-relaxed text-rose-200">{errorMsg}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@sundiving.com"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-teal-400 hover:from-sky-600 hover:to-teal-500 text-slate-950 font-black text-sm shadow-lg shadow-sky-500/25 transition disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Sign In to Centre'}
            </button>
          </form>

          {/* Policy Note per PDF Page 2 */}
          <div className="pt-2 text-[11px] text-slate-400 text-center leading-relaxed border-t border-slate-800/80">
            Passwords are administrator-set. Five wrong passwords in a row temporarily locks sign-in for security.
          </div>
        </div>

        {/* Demo Accounts Quick-Fill Pill */}
        <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80 space-y-2">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider text-center">
            Demo Credentials (Click to test):
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => fillCredentials('admin@sundiving.com', 'AdminPassword123!')}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-left transition border border-slate-700/60"
            >
              <span className="font-bold text-sky-400 block">👑 Global Admin</span>
              <span className="text-[10px] text-slate-400 truncate block">admin@sundiving.com</span>
            </button>

            <button
              type="button"
              onClick={() => fillCredentials('manager@sundiving.com', 'ManagerPass123!')}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-left transition border border-slate-700/60"
            >
              <span className="font-bold text-amber-400 block">🏢 Property Manager</span>
              <span className="text-[10px] text-slate-400 truncate block">manager@sundiving.com</span>
            </button>

            <button
              type="button"
              onClick={() => fillCredentials('staff@sundiving.com', 'StaffPass123!')}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-left transition border border-slate-700/60"
            >
              <span className="font-bold text-teal-400 block">🤿 Centre Staff (Malé)</span>
              <span className="text-[10px] text-slate-400 truncate block">staff@sundiving.com</span>
            </button>

            <button
              type="button"
              onClick={() => fillCredentials('staff.ari@sundiving.com', 'StaffPass123!')}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-left transition border border-slate-700/60"
            >
              <span className="font-bold text-indigo-400 block">🏝️ Centre Staff (Ari)</span>
              <span className="text-[10px] text-slate-400 truncate block">staff.ari@sundiving.com</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
