"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";

const LINKS = [
  { href: "/setup", label: "Setup" },
  { href: "/history", label: "History" },
] as const;

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <span aria-hidden className="relative inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent">
        <span className="ml-0.5 block h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
      </span>
      <span className="text-[17px] font-semibold tracking-tight text-ink">ReelRelay</span>
    </span>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { email, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      router.replace("/login");
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/setup" className="shrink-0 rounded-md">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="ml-2 flex items-center gap-1 sm:ml-6">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "text-ink" : "text-ink-muted hover:bg-surface hover:text-ink"
                }`}
              >
                {link.label}
                {active && <span aria-hidden className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-accent" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-3">
          {email && (
            <span className="hidden max-w-[220px] truncate text-sm text-ink-muted sm:inline" title={email}>
              {email}
            </span>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
