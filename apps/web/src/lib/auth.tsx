'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from './api';
import type { RoleKey, SessionUser } from './types';
import { can, visibleNavItems } from './permissions';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  nav: typeof visibleNavItems extends (...a: never) => infer R ? R : never;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api.get<SessionUser>('/auth/me');
      setUser(me);
      setError(null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const result = await api.post<{ accessToken: string; user: SessionUser }>('/auth/login', { email, password });
      setAccessToken(result.accessToken);
      setUser(result.user);
      router.push('/painel');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar.');
      throw err;
    }
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* mesmo se falhar, limpamos o estado local */
    }
    setAccessToken(null);
    setUser(null);
    router.push('/entrar');
  }, [router]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      login,
      logout,
      refresh: loadSession,
      can: (permission: string) =>
        user ? can(user.roles as RoleKey[], user.permissions ?? [], permission) : false,
      nav: user ? visibleNavItems(user.roles as RoleKey[], user.permissions ?? []) : [],
    }),
    [user, loading, error, login, logout, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  return context;
}
