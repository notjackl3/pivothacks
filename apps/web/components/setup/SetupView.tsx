"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getIntegrations, getPreferences, getTrackedEntities } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { languageLabel } from "@/lib/status";
import { AppShell } from "@/components/AppShell";
import { ErrorBanner, LinkButton } from "@/components/ui";
import { SetupChecklist, type SetupStep } from "@/components/setup/SetupChecklist";
import { SlackCard, type SlackCallbackResult } from "@/components/setup/SlackCard";
import { TelegramCard } from "@/components/setup/TelegramCard";
import { SenderPicker } from "@/components/setup/SenderPicker";
import { LanguagePicker } from "@/components/setup/LanguagePicker";

export function SetupView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const integrations = useResource(getIntegrations);
  const tracked = useResource(getTrackedEntities);
  const prefs = useResource(getPreferences);

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
      key: "slack",
      label: "Connect Slack",
      state: slack?.connected ? (slack.status === "active" ? "done" : "warning") : "todo",
      detail: slack?.connected ? slack.teamName ?? slack.teamId : "Authorize your workspace",
    },
    {
      key: "telegram",
      label: "Pair Telegram",
      state: telegram?.connected ? "done" : "todo",
      detail: telegram?.connected ? "Bot chat linked" : "One-time code",
    },
    {
      key: "sender",
      label: slack?.mode === "bot_token" ? "Track a channel" : "Track a sender",
      state: currentTracked ? "done" : "todo",
      detail: currentTracked ? currentTracked.displayName : "Pick one person",
    },
    {
      key: "language",
      label: "Choose language",
      state: prefs.data ? "done" : "todo",
      detail: prefs.data ? languageLabel(prefs.data.targetLanguage) : "Defaults to Simplified Chinese",
    },
  ];

  const firstError = integrations.error ?? tracked.error ?? prefs.error;

  return (
    <AppShell
      title="Setup"
      description="Four steps. Once they are all green, a DM from your tracked sender becomes a reel on your phone."
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
              void tracked.refresh();
              void prefs.refresh();
            }}
          />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <SlackCard
            slack={slack}
            loading={integrations.loading}
            callback={callback}
            onDismissCallback={dismissCallback}
            onChanged={async () => {
              await Promise.all([integrations.refresh(), tracked.refresh()]);
            }}
            index={1}
          />
          <TelegramCard telegram={telegram} loading={integrations.loading} onRefresh={integrations.refresh} index={2} />
          <SenderPicker slack={slack} tracked={trackedEntities} onChanged={tracked.refresh} index={3} />
          <LanguagePicker prefs={prefs.data} loading={prefs.loading} onSaved={handlePrefsSaved} index={4} />
        </div>

        <p className="rr-rise px-1 text-xs leading-5 text-ink-faint" style={{ animationDelay: "320ms" }}>
          Privacy: only messages from your one tracked sender are stored. Message text is processed by Anthropic (interpretation and
          drafts) and ElevenLabs (narration). Nothing is posted to Slack until you approve it. Slack tokens are encrypted at rest.
        </p>
      </div>
    </AppShell>
  );
}
