"use client";

import { useState } from "react";
import type { ComposioSourcesResponse, ComposioToolkit } from "@reelrelay/shared";
import { connectComposioSource, describeError } from "@/lib/api";
import { useInterval } from "@/lib/hooks";
import { Banner, Button, Card, Chip } from "@/components/ui";

const SOURCE_META: Record<ComposioToolkit, { name: string; mark: string; note: string }> = {
  gmail: { name: "Gmail", mark: "M", note: "New inbox email" },
  slack: { name: "Slack", mark: "S", note: "Direct messages" },
  outlook: { name: "Outlook", mark: "O", note: "New inbox email" },
  whatsapp: { name: "WhatsApp", mark: "W", note: "Business messages" },
};

export function InboundSourcesCard({ data, loading, onRefresh, index = 0 }: {
  data: ComposioSourcesResponse | null;
  loading: boolean;
  onRefresh: () => Promise<unknown>;
  index?: number;
}) {
  const [busy, setBusy] = useState<ComposioToolkit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasPending = data?.sources.some((source) => source.status === "pending") ?? false;
  useInterval(() => { void onRefresh(); }, hasPending ? 3000 : null);

  async function connect(toolkit: ComposioToolkit) {
    setBusy(toolkit); setError(null);
    try {
      const result = await connectComposioSource(toolkit);
      window.location.assign(result.redirectUrl);
    } catch (err) {
      setError(describeError(err)); setBusy(null);
    }
  }

  const configured = data?.configuredToolkits ?? [];
  const activeCount = data?.sources.filter((source) => source.status === "active").length ?? 0;
  return (
    <Card eyebrow="Inputs" title="Connected inboxes" description="Choose where ReelRelay watches for important incoming messages. Authorization is handled securely by Composio." action={<Chip tone={activeCount ? "success" : "neutral"} size="md">{activeCount} active</Chip>} index={index} className="lg:col-span-2">
      <div className="space-y-4">
        {error ? <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner> : null}
        {!loading && configured.length === 0 ? <Banner tone="warning">Inbound account connections are not configured yet. Add the Composio settings from the setup guide.</Banner> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(SOURCE_META) as ComposioToolkit[]).map((toolkit) => {
            const meta = SOURCE_META[toolkit];
            const sources = data?.sources.filter((source) => source.toolkit === toolkit) ?? [];
            const active = sources.find((source) => source.status === "active");
            const pending = sources.find((source) => source.status === "pending");
            const broken = sources.find((source) => source.status === "expired" || source.status === "error");
            const enabled = configured.includes(toolkit);
            return (
              <div key={toolkit} className="group flex items-center gap-3 rounded-xl border border-line bg-surface-muted/70 p-3 transition-colors hover:border-line-strong hover:bg-surface-muted">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface font-mono text-sm font-bold text-ink shadow-sm">{meta.mark}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><p className="font-medium text-ink">{meta.name}</p>{active ? <Chip tone="success">Connected</Chip> : pending ? <Chip tone="accent" active>Finishing</Chip> : broken ? <Chip tone="warning">Reconnect</Chip> : null}</div>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">{active?.label ?? broken?.errorDetail ?? meta.note}</p>
                </div>
                <Button size="sm" variant={active ? "secondary" : "primary"} disabled={!enabled || Boolean(pending)} loading={busy === toolkit} onClick={() => void connect(toolkit)}>{active ? "Add another" : broken ? "Reconnect" : "Connect"}</Button>
              </div>
            );
          })}
        </div>
        <p className="text-xs leading-5 text-ink-faint">Only incoming trigger events enter the reel pipeline. Provider credentials stay with Composio and are never returned to the browser.</p>
      </div>
    </Card>
  );
}
