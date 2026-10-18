import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { Profile } from '../types';

interface AuthCtx {
  user: Profile | null; loading: boolean;
  signIn(identifier: string, password: string): Promise<Profile>;
  signOut(): Promise<void>; refresh(): Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try { setUser(await api.getCurrentUser()); } catch { setUser(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<AuthCtx>(() => ({
    user, loading, refresh,
    async signIn(identifier, password) { const p = await api.signIn(identifier, password); setUser(p); return p; },
    async signOut() { await api.signOut(); setUser(null); },
  }), [user, loading, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth(): AuthCtx { const c = useContext(Ctx); if (!c) throw new Error('useAuth outside AuthProvider'); return c; }
