"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Wordmark } from "@/components/TopNav";
import { Banner, Button, Input, Label } from "@/components/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

export function LoginView() {
  const { loading, session, configError } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    if (!loading && session) router.replace("/setup");
  }, [loading, session, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setPhase({ kind: "sending" });
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setPhase({ kind: "error", message: error.message });
        return;
      }
      setPhase({ kind: "sent", email: trimmed });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Could not send the link" });
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-6xl items-center px-4 py-5 sm:px-6">
        <Wordmark />
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-24 sm:px-6">
        <div className="rr-rise">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Sign in</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Your inbox, in your language.</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            ReelRelay turns dense Slack messages into short narrated reels on Telegram, and posts only the replies you approve.
          </p>
        </div>

        <div className="rr-rise mt-8 rounded-2xl border border-line bg-surface p-6 shadow-card" style={{ animationDelay: "80ms" }}>
          {configError && (
            <Banner tone="danger" title="Web app is not configured" className="mb-4">
              {configError}
            </Banner>
          )}
          {urlError && phase.kind === "idle" && (
            <Banner tone="danger" title="Sign-in link failed" className="mb-4" onDismiss={() => router.replace("/login")}>
              {urlError}
            </Banner>
          )}

          {phase.kind === "sent" ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-2xl">✉️</div>
              <h2 className="mt-4 text-lg font-semibold text-ink">Check your email</h2>
              <p className="mt-2 text-sm text-ink-muted">
                We sent a sign-in link to <span className="font-medium text-ink">{phase.email}</span>. Open it on this device to continue.
              </p>
              <Button variant="ghost" size="sm" className="mt-5" onClick={() => setPhase({ kind: "idle" })}>
                Use a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder="you@university.edu"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={phase.kind === "sending" || Boolean(configError)}
                />
              </div>
              {phase.kind === "error" && <Banner tone="danger">{phase.message}</Banner>}
              <Button type="submit" size="lg" className="w-full" loading={phase.kind === "sending"} disabled={Boolean(configError)}>
                Send magic link
              </Button>
              <p className="text-center text-xs text-ink-faint">No password. The link signs you in on this browser.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
