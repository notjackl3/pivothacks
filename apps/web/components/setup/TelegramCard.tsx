"use client";

import { useState } from "react";
import type { PairingCodeResponse, TelegramIntegrationState } from "@reelrelay/shared";
import { createPairingCode, describeError } from "@/lib/api";
import { useInterval, useNow } from "@/lib/hooks";
import { botUsernameFromDeepLink, formatCountdown } from "@/lib/format";
import { Banner, Button, Card, Chip, LinkButton } from "@/components/ui";

const POLL_MS = 3000;
const POLL_LIMIT_MS = 10 * 60 * 1000;

export interface TelegramCardProps {
  telegram: TelegramIntegrationState | null;
  loading: boolean;
  /** Re-fetches integrations; the card polls this until `telegram.connected`. */
  onRefresh: () => Promise<unknown>;
  index?: number;
}

export function TelegramCard({ telegram, loading, onRefresh, index = 0 }: TelegramCardProps) {
  const [pairing, setPairing] = useState<{ code: PairingCodeResponse; startedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const paired = Boolean(telegram?.connected);
  const expiresAtMs = pairing ? Date.parse(pairing.code.expiresAt) : NaN;
  const remainingMs = Number.isNaN(expiresAtMs) || now === 0 ? null : expiresAtMs - now;
  const expired = remainingMs !== null && remainingMs <= 0;
  const pollingTimedOut = pairing !== null && now !== 0 && now - pairing.startedAt > POLL_LIMIT_MS;
  const polling = pairing !== null && !paired && !expired && !pollingTimedOut;

  useInterval(() => {
    void onRefresh();
  }, polling ? POLL_MS : null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const code = await createPairingCode();
      setPairing({ code, startedAt: Date.now() });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const botUsername = pairing ? botUsernameFromDeepLink(pairing.code.deepLink) : null;

  const statusChip = paired ? (
    <Chip tone="success" size="md">
      Paired
    </Chip>
  ) : polling ? (
    <Chip tone="accent" size="md" active>
      Waiting
    </Chip>
  ) : (
    <Chip tone="neutral" size="md">
      Not paired
    </Chip>
  );

  return (
    <Card eyebrow="Step 2" title="Telegram" description="The destination. Reels and reply drafts arrive in a private chat with the bot." action={statusChip} index={index}>
      <div className="space-y-4">
        {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}

        {loading && !telegram ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : paired ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base font-medium text-ink">
              Paired ✅ <span className="text-sm font-normal text-ink-muted">· chat {telegram?.chatId}</span>
            </p>
            <Button variant="secondary" size="sm" onClick={requestCode} loading={busy}>
              Pair a different chat
            </Button>
          </div>
        ) : !pairing ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">Get a one-time code, then open the bot and send it. Codes expire after a few minutes.</p>
            <Button size="lg" onClick={requestCode} loading={busy}>
              Get pairing code
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface-muted p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Your pairing code</p>
            <p className="mt-2 select-all font-mono text-4xl font-medium tracking-[0.18em] text-ink tabular-nums sm:text-5xl">{pairing.code.code}</p>
            <p className="mt-2 text-sm tabular-nums text-ink-muted">
              {expired ? (
                <span className="text-danger">Code expired.</span>
              ) : remainingMs === null ? (
                "Expires soon."
              ) : (
                <>
                  Expires in <span className="font-medium text-ink">{formatCountdown(remainingMs)}</span>
                </>
              )}
              {polling && <span className="ml-2 text-ink-faint">· checking every 3 s</span>}
              {pollingTimedOut && <span className="ml-2 text-ink-faint">· stopped checking; refresh the page after pairing</span>}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!expired ? (
                <LinkButton href={pairing.code.deepLink} variant="primary" size="lg" external>
                  Open Telegram
                </LinkButton>
              ) : (
                <Button size="lg" onClick={requestCode} loading={busy}>
                  Get a new code
                </Button>
              )}
              {!expired && (
                <Button variant="ghost" size="sm" onClick={requestCode} loading={busy}>
                  New code
                </Button>
              )}
            </div>

            {!expired && (
              <p className="mt-4 text-sm text-ink-muted">
                or send{" "}
                <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink">/start {pairing.code.code}</code> to{" "}
                {botUsername ? (
                  <a href={`https://t.me/${botUsername}`} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-strong underline-offset-2 hover:underline">
                    @{botUsername}
                  </a>
                ) : (
                  "the bot"
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
