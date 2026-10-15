'use client';

import { createContext, useCallback, useContext, useMemo, ReactNode } from 'react';
/**
 * LAN/self-hosted builds have no account system at all.
 *
 * This provider deliberately keeps the original context shape so the ~48
 * `useAuth()` call sites stay untouched, but it is *always* signed out and
 * every mutator is a no-op. What it removes, relative to upstream:
 *
 *   - the Supabase client (and with it the module-level `createClient` that
 *     pointed at Readest's public project unless overridden),
 *   - `supabase.auth.refreshSession()` on mount, which was the one request a
 *     cold start made to an external host,
 *   - the localStorage session mirror and `posthog.identify(user.id)`.
 *
 * See the plan (§4 Phase 2.5-A): login is deleted, not merely hidden.
 */
/**
 * Structural stand-in for the Supabase user object the upstream context
 * carried. Call sites only ever read `id`, `email` and a couple of
 * `user_metadata` keys, all of which are always absent here.
 */
export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const login = useCallback((_token: string, _user: AuthUser) => {}, []);
  const logout = useCallback(() => {}, []);
  const refresh = useCallback(() => {}, []);

  const value = useMemo(
    () => ({ token: null, user: null, login, logout, refresh }),
    [login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
