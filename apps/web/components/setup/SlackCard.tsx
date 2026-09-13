"use client";

import { useState } from "react";
import type { ConnectionMode, SlackIntegrationState } from "@reelrelay/shared";
import { deleteIntegration, describeError, startSlack } from "@/lib/api";
import { connectionModeLabel } from "@/lib/status";
import { Banner, Button, Card, Chip, KeyValue } from "@/components/ui";

export interface SlackCallbackResult {
  status: "ok" | "error";
  reason: string | null;
}

export interface SlackCardProps {
  slack: SlackIntegrationState | null;
  loading: boolean;
  /** Parsed from `?slack=ok` / `?slack=error&reason=` after the OAuth redirect. */
  callback: SlackCallbackResult | null;
  onDismissCallback: () => void;
  onChanged: () => Promise<unknown>;
  index?: number;
}

export function SlackCard({ slack, loading, callback, onDismissCallback, onChanged, index = 0 }: SlackCardProps) {
  const [busy, setBusy] = useState<"connect" | "bot" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = Boolean(slack?.connected);
  const healthy = connected && slack?.status === "active";
  const needsReconnect = connected && !healthy;

  async function connect(mode?: ConnectionMode) {
    setBusy(mode === "bot_token" ? "bot" : "connect");
    setError(null);
    try {
      const { url } = await startSlack(mode);
      window.location.assign(url);
    } catch (err) {
      setError(describeError(err));
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!slack) return;
    if (!window.confirm("Disconnect Slack? Tracked senders and stored messages for this connection are removed.")) return;
    setBusy("disconnect");
    setError(null);
    try {
      await deleteIntegration(slack.connectionId);
      await onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  const statusChip = !connected ? (
    <Chip tone="neutral" size="md">
      Not connected
    </Chip>
  ) : healthy ? (
    <Chip tone="success" size="md">
      Connected
    </Chip>
  ) : (
    <Chip tone="danger" size="md">
      {slack?.status === "revoked" ? "Revoked" : "Error"}
    </Chip>
  );

  return (
    <Card eyebrow="Step 1" title="Slack" description="The source. Only DMs from the one sender you track are read." action={statusChip} index={index}>
      <div className="space-y-4">
        {callback?.status === "ok" && (
          <Banner tone="success" title="Slack connected" onDismiss={onDismissCallback}>
            Your workspace is linked. Next: pair Telegram and pick the sender to track.
          </Banner>
        )}
        {callback?.status === "error" && (
          <Banner tone="danger" title="Slack connection failed" onDismiss={onDismissCallback}>
            {callback.reason ?? "Slack returned an error. Try again."}
          </Banner>
        )}
        {error && <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner>}

        {loading && !slack ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : !connected ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">Authorize ReelRelay to read your Slack DMs and post approved replies as you.</p>
            <Button size="lg" onClick={() => connect()} loading={busy === "connect"} disabled={busy !== null}>
              Connect Slack
            </Button>
          </div>
        ) : (
          <>
            {needsReconnect && (
              <Banner tone="warning" title={slack?.status === "revoked" ? "Slack access was revoked" : "Slack token stopped working"}>
                Reconnect to keep receiving messages and sending replies.
              </Banner>
            )}
            <dl className="grid gap-4 sm:grid-cols-3">
              <KeyValue label="Workspace">{slack?.teamName ?? slack?.teamId ?? "—"}</KeyValue>
              <KeyValue label="Signed in as">{slack?.userName ?? "—"}</KeyValue>
              <KeyValue label="Mode">
                <span className="capitalize">{slack?.mode === "bot_token" ? "Bot" : "User"}</span>
                <span className="text-ink-muted"> · {slack ? connectionModeLabel(slack.mode) : ""}</span>
              </KeyValue>
            </dl>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {needsReconnect ? (
                <Button size="lg" onClick={() => connect(slack?.mode)} loading={busy === "connect"} disabled={busy !== null}>
                  Reconnect
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => connect(slack?.mode)} loading={busy === "connect"} disabled={busy !== null}>
                  Reconnect
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={disconnect} loading={busy === "disconnect"} disabled={busy !== null}>
                Disconnect
              </Button>
            </div>
          </>
        )}

        {slack?.mode !== "bot_token" && (
          <p className="border-t border-line pt-3 text-xs text-ink-faint">
            DMs not reaching the app?{" "}
            <button
              type="button"
              onClick={() => connect("bot_token")}
              disabled={busy !== null}
              className="font-medium text-accent-strong underline decoration-accent-ring underline-offset-2 hover:text-accent disabled:opacity-60"
            >
              {busy === "bot" ? "Starting…" : "Use bot mode instead"}
            </button>
            . Replies then post as the bot, prefixed “On behalf of you”, and you track a channel instead of a person.
          </p>
        )}
      </div>
    </Card>
  );
}
