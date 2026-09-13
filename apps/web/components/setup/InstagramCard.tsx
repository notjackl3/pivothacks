"use client";

import { useState } from "react";
import type { InstagramIntegrationState, InstagramPairingCodeResponse } from "@reelrelay/shared";
import { createInstagramPairingCode, describeError } from "@/lib/api";
import { useInterval, useNow } from "@/lib/hooks";
import { formatCountdown } from "@/lib/format";
import { Banner, Button, Card, Chip, LinkButton } from "@/components/ui";

export function InstagramCard({ instagram, loading, onRefresh, index = 0 }: {
  instagram: InstagramIntegrationState | null;
  loading: boolean;
  onRefresh: () => Promise<unknown>;
  index?: number;
}) {
  const [pairing, setPairing] = useState<InstagramPairingCodeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const remaining = pairing && now ? Date.parse(pairing.expiresAt) - now : null;
  const waiting = Boolean(pairing && remaining !== null && remaining > 0 && !instagram?.connected);
  useInterval(() => { void onRefresh(); }, waiting ? 3000 : null);

  async function beginPairing() {
    setBusy(true); setError(null);
    try { setPairing(await createInstagramPairingCode()); }
    catch (err) { setError(describeError(err)); }
    finally { setBusy(false); }
  }

  const state = instagram?.connected
    ? <Chip tone={instagram.windowOpen ? "success" : "warning"} size="md">{instagram.windowOpen ? "Ready" : "Wake bot"}</Chip>
    : waiting ? <Chip tone="accent" size="md" active>Waiting</Chip> : <Chip tone="neutral" size="md">Not paired</Chip>;

  return (
    <Card eyebrow="Delivery" title="Instagram" description="Reels arrive as private messages from the ReelRelay professional account." action={state} index={index}>
      <div className="space-y-4">
        {error ? <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner> : null}
        {loading && !instagram ? <p className="text-sm text-ink-muted">Loading…</p> : instagram?.connected ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Connected to Instagram recipient <span className="font-mono text-ink">{instagram.recipientId}</span>.</p>
            {!instagram.windowOpen ? <Banner tone="warning">Send any DM to the ReelRelay account to reopen Instagram delivery.</Banner> : null}
            <Button variant="secondary" size="sm" loading={busy} onClick={beginPairing}>Pair a different account</Button>
          </div>
        ) : !pairing ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">Generate a code, open Instagram, and DM the code to ReelRelay.</p>
            <Button size="lg" loading={busy} onClick={beginPairing}>Pair Instagram</Button>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface-muted p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">DM this exact code</p>
            <p className="mt-2 select-all font-mono text-4xl font-medium tracking-[0.18em] text-ink">{pairing.code}</p>
            <p className="mt-2 text-sm text-ink-muted">{remaining !== null && remaining > 0 ? <>Expires in <span className="font-medium text-ink">{formatCountdown(remaining)}</span></> : "Code expired."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href={pairing.deepLink} external variant="primary" size="lg">Open Instagram</LinkButton>
              <Button variant="ghost" size="sm" loading={busy} onClick={beginPairing}>New code</Button>
            </div>
            <p className="mt-4 text-sm text-ink-muted">Instagram cannot prefill the DM. Paste <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink">{pairing.code}</code> into the conversation.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
