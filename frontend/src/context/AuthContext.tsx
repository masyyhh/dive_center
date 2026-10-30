import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '../types';
import { apiFetch, getAuthToken, setAuthToken, revokeSession, connectTestingLiveSignIn } from '../services/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; attemptsRemaining?: number; changeToken?: string }>;
  connectLive: () => Promise<void>;
  logout: () => Promise<void>;
  signingOut: boolean;
  logoutError: string;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    try {
      const token = getAuthToken();
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      const data = await apiFetch<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch (err) {
      console.warn('Failed to refresh user profile:', err);
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const data = await apiFetch<{ token: string; user: User; passwordChangeRequired?: boolean; changeToken?: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
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
    setAuthToken(data.token); setUser(data.user);
  };

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true); setLogoutError('');
    try {
      await revokeSession();
      setUser(null);
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : 'Could not sign out. Please try again.');
    } finally { setSigningOut(false); }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, connectLive, logout, refreshUser, signingOut, logoutError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
