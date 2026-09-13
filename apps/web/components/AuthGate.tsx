"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Banner, FullPageSpinner } from "@/components/ui";

/** Renders children only with a Supabase session; otherwise sends the browser to /login. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, configError } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session && !configError) router.replace("/login");
  }, [loading, session, configError, router]);

  if (configError) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <Banner tone="danger" title="Web app is not configured">
          {configError}. Add it to the root <code className="font-mono">.env</code> and restart <code className="font-mono">next dev</code>.
        </Banner>
      </div>
    );
  }
  if (loading) return <FullPageSpinner label="Checking your session…" />;
  if (!session) return <FullPageSpinner label="Redirecting to sign in…" />;
  return <>{children}</>;
}
