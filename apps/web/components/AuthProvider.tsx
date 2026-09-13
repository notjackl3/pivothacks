"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, getSupabaseConfigError } from "@/lib/supabase/client";

export interface AuthState {
  /** True until the stored session has been read once. */
  loading: boolean;
  session: Session | null;
  email: string | null;
  /** Set when NEXT_PUBLIC_SUPABASE_* is missing; the app cannot sign anyone in. */
  configError: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configError = getSupabaseConfigError();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configError === null);

  useEffect(() => {
    if (configError) return;
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [configError]);

  const signOut = useCallback(async () => {
    if (configError) return;
    await getSupabaseBrowserClient().auth.signOut();
    setSession(null);
  }, [configError]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      email: session?.user.email ?? null,
      configError,
      signOut,
    }),
    [loading, session, configError, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
