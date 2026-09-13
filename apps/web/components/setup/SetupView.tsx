"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getComposioSources, getIntegrations, getPreferences, getTrackedEntities } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { languageLabel } from "@/lib/status";
import { AppShell } from "@/components/AppShell";
import { ErrorBanner, LinkButton } from "@/components/ui";
import { SetupChecklist, type SetupStep } from "@/components/setup/SetupChecklist";
import { SlackCard, type SlackCallbackResult } from "@/components/setup/SlackCard";
import { TelegramCard } from "@/components/setup/TelegramCard";
import { InstagramCard } from "@/components/setup/InstagramCard";
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
  const instagram = integrations.data?.instagram ?? null;
  const trackedEntities = tracked.data?.entities ?? null;

  const handlePrefsSaved = useCallback(() => {
    void prefs.refresh();
  }, [prefs]);

  const steps: SetupStep[] = [
    {
      key: "sources",
      label: "Connect inboxes",
      state: sources.data?.sources.some((source) => source.status === "active") ? "done" : "todo",
      detail: sources.data?.sources.some((source) => source.status === "active") ? `${sources.data.sources.filter((source) => source.status === "active").length} connected` : "Gmail, Slack, Outlook or WhatsApp",
    },
    {
      key: "instagram",
      label: "Pair Instagram",
      state: instagram?.connected ? (instagram.windowOpen ? "done" : "warning") : "todo",
      detail: instagram?.connected ? (instagram.windowOpen ? "Ready for delivery" : "DM the bot to wake it") : "One-time DM code",
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
      description="Connect your inboxes once. ReelRelay watches authorized incoming messages and delivers each reel through Instagram."
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
          <InstagramCard instagram={instagram} loading={integrations.loading} onRefresh={integrations.refresh} index={3} />
          <TelegramCard telegram={telegram} loading={integrations.loading} onRefresh={integrations.refresh} index={4} />
          <SenderPicker slack={slack} tracked={trackedEntities} onChanged={tracked.refresh} index={5} />
          <LanguagePicker prefs={prefs.data} loading={prefs.loading} onSaved={handlePrefsSaved} index={6} />
        </div>

        <p className="rr-rise px-1 text-xs leading-5 text-ink-faint" style={{ animationDelay: "320ms" }}>
          Privacy: only messages delivered by the inbox triggers you enable are stored. Message text is processed by Anthropic
          (interpretation and drafts) and ElevenLabs (narration). Provider credentials remain with Composio; Instagram delivery uses a server-only token.
        </p>
      </div>
    </AppShell>
  );
}
