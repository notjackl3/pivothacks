"use client";

import type { ReactNode } from "react";
import { AuthGate } from "@/components/AuthGate";
import { TopNav } from "@/components/TopNav";

export interface AppShellProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls in the page header. */
  actions?: ReactNode;
  /** Rendered above the title (e.g. a back link). */
  breadcrumb?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

/** Auth gate + top navigation + page header. Every signed-in page renders inside it. */
export function AppShell({ title, description, actions, breadcrumb, wide = false, children }: AppShellProps) {
  return (
    <AuthGate>
      <TopNav />
      <main className={`mx-auto w-full ${wide ? "max-w-6xl" : "max-w-5xl"} flex-1 px-4 pb-16 pt-8 sm:px-6`}>
        {(title || actions || breadcrumb) && (
          <div className="rr-rise mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              {breadcrumb && <div className="mb-2 text-sm text-ink-muted">{breadcrumb}</div>}
              {title && <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>}
              {description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        )}
        {children}
      </main>
    </AuthGate>
  );
}
