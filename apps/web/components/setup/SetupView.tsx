"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getComposioSources, getIntegrations, getPreferences, getTrackedEntities } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { languageLabel } from "@/lib/status";
import { AppShell } from "@/components/AppShell";
import { ErrorBanner, LinkButton } from "@/components/ui";
import { SetupChecklist, type SetupStep } from "@/components/setup/SetupChecklist";
import { SlackCard, type SlackCallbackResult } from "@/components/setup/SlackCard";
import { TelegramCard } from "@/components/setup/TelegramCard";
import { InboundSourcesCard } from "@/components/setup/InboundSourcesCard";
import { SenderPicker } from "@/components/setup/SenderPicker";
import { LanguagePicker } from "@/components/setup/LanguagePicker";

export function SetupView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const integrations = useResource(getIntegrations);
  const tracked = useResource(getTrackedEntities);
  const prefs = useResource(getPreferences);
  const sources = useResource(getComposioSources);

  const slackParam = searchParams.get("slack");
  const callback: SlackCallbackResult | null =
    slackParam === "ok" ? { status: "ok", reason: null } : slackParam === "error" ? { status: "error", reason: searchParams.get("reason") } : null;
  const dismissCallback = useCallback(() => router.replace("/setup"), [router]);

  const slack = integrations.data?.slack ?? null;
  const telegram = integrations.data?.telegram ?? null;
  const trackedEntities = tracked.data?.entities ?? null;
  const currentTracked = useMemo(() => trackedEntities?.find((entity) => entity.enabled) ?? null, [trackedEntities]);

  const handlePrefsSaved = useCallback(() => {
    void prefs.refresh();
  }, [prefs]);

  const steps: SetupStep[] = [
    {
      key: "sources",
      label: "Connect inboxes",
      state: sources.data?.sources.some((source) => source.status === "active") ? "done" : "todo",
      detail: sources.data?.sources.some((source) => source.status === "active") ? `${sources.data.sources.filter((source) => source.status === "active").length} connected` : "Gmail, Slack, Outlook, WhatsApp or Instagram",
    },
    {
      key: "telegram",
      label: "Pair Telegram",
      state: telegram?.connected ? "done" : "todo",
      detail: telegram?.connected ? "Ready for delivery" : "One-time pairing code",
    },
    {
      key: "sender",
      label: slack?.mode === "bot_token" ? "Track a channel" : "Track a sender",
      state: currentTracked ? "done" : "todo",
      detail: currentTracked ? `${currentTracked.displayName} · ${currentTracked.relationship}` : "Who, and who they are to you",
    },
    {
      key: "language",
      label: "Choose language",
      state: prefs.data ? "done" : "todo",
      detail: prefs.data ? languageLabel(prefs.data.targetLanguage) : "Defaults to Simplified Chinese",
    },
  ];

  const firstError = integrations.error ?? sources.error ?? tracked.error ?? prefs.error;

  return (
    <AppShell
      title="Setup"
      description="Connect your inboxes once. ReelRelay triages every incoming message by urgency, deadline, quiet hours and sender, then delivers the reel through Telegram."
      actions={
        <LinkButton href="/history" variant="secondary">
          View history
        </LinkButton>
      }
    >
      <div className="space-y-5">
        <SetupChecklist steps={steps} />

        {firstError ? (
          <ErrorBanner
            error={firstError}
            onDismiss={() => {
              void integrations.refresh();
              void sources.refresh();
              void tracked.refresh();
              void prefs.refresh();
            }}
          />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <InboundSourcesCard data={sources.data} loading={sources.loading} onRefresh={sources.refresh} index={1} />
          <SlackCard
            slack={slack}
            loading={integrations.loading}
            callback={callback}
            onDismissCallback={dismissCallback}
            onChanged={async () => {
              await Promise.all([integrations.refresh(), tracked.refresh()]);
            }}
            index={2}
          />
          <TelegramCard telegram={telegram} loading={integrations.loading} onRefresh={integrations.refresh} index={3} />
          <SenderPicker slack={slack} tracked={trackedEntities} onChanged={tracked.refresh} index={4} />
          <LanguagePicker prefs={prefs.data} loading={prefs.loading} onSaved={handlePrefsSaved} index={5} />
        </div>

        <p className="rr-rise px-1 text-xs leading-5 text-ink-faint" style={{ animationDelay: "320ms" }}>
          Privacy: only messages delivered by the inbox triggers you enable are stored. Message text is processed by an AI model
          (interpretation and drafts) and ElevenLabs (narration). Provider credentials remain with Composio; Telegram delivery uses a server-only bot token.
        </p>
      </div>
    </AppShell>
  );
}
