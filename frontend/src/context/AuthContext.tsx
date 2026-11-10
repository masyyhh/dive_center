import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User } from '../types';
import { apiFetch, getAuthToken, setAuthToken, revokeSession, connectTestingLiveSignIn, ApiError } from '../services/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  profileError: string;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; attemptsRemaining?: number; changeToken?: string }>;
  connectLive: () => Promise<void>;
  logout: () => Promise<void>;
  signingOut: boolean;
  logoutError: string;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profileError, setProfileError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [loading, setLoading] = useState<boolean>(true);

  const profileRequest = useRef(0);
  const refreshUser = async () => {
    const request = ++profileRequest.current;
    setProfileError('');
    if (!user) setLoading(true);
    const token = getAuthToken();
    try {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      const data = await apiFetch<{ user: User }>('/auth/me');
      if (request === profileRequest.current && token === getAuthToken()) setUser(data.user);
    } catch (err) {
      if (request !== profileRequest.current || token !== getAuthToken()) return;
      console.warn('Failed to refresh user profile:', err);
      if (err instanceof ApiError && err.status === 401) { setAuthToken(null); setUser(null); }
      else setProfileError(err instanceof Error ? err.message : 'Could not verify your session.');
    } finally {
      if (request === profileRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
    return () => { profileRequest.current++; };
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const data = await apiFetch<{ token: string; user: User; passwordChangeRequired?: boolean; changeToken?: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      profileRequest.current++; setLoading(false); setProfileError('');
      if (data.passwordChangeRequired) {
        setAuthToken(null); setUser(null);
        return { success: true, changeToken: data.changeToken };
      }
      setAuthToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const connectLive = async () => {
    const data = await connectTestingLiveSignIn();
    profileRequest.current++; setLoading(false); setProfileError('');
    setAuthToken(data.token); setUser(data.user);
  };

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true); setLogoutError('');
    try {
      await revokeSession();
      profileRequest.current++; setLoading(false); setProfileError('');
      setUser(null);
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : 'Could not sign out. Please try again.');
    } finally { setSigningOut(false); }
  };

  return (
    <AuthContext.Provider value={{ user, loading, profileError, login, connectLive, logout, refreshUser, signingOut, logoutError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
