"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { ReplyDraftRecord, ReplyTone } from "@reelrelay/shared";
import { ApiClientError, approveReply, describeError, getMessage, regenerateReply, retryMessage, retrySendReply } from "@/lib/api";
import { useAsyncAction, useInterval, useNow, useResource } from "@/lib/hooks";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format";
import { isJobTerminal, jobStatusMeta, messageSourceLabel, urgencyMeta } from "@/lib/status";
import { AppShell } from "@/components/AppShell";
import { Banner, Button, Chip, EmptyState, ErrorBanner, FullPageSpinner, MockBadge } from "@/components/ui";
import { JobStatus } from "@/components/history/JobStatus";
import { ReelPlayer } from "@/components/history/ReelPlayer";
import { OriginalText } from "@/components/history/OriginalText";
import { ActionsList } from "@/components/history/ActionsList";
import { DraftList } from "@/components/history/DraftList";

const POLL_MS = 3000;

function draftInFlight(draft: ReplyDraftRecord): boolean {
  return draft.status === "approved" || draft.status === "send_uncertain";
}

export function MessageDetail({ id }: { id: string }) {
  const loader = useCallback(() => getMessage(id), [id]);
  const { data, error, loading, refresh } = useResource(loader);
  const { busyKey, actionError, run, clearError } = useAsyncAction();
  const [notice, setNotice] = useState<string | null>(null);
  const now = useNow();

  const jobStatus = data?.job?.status ?? "queued";
  const polling = data !== null && (!isJobTerminal(jobStatus) || data.drafts.some(draftInFlight));

  useInterval(() => {
    void refresh();
  }, polling ? POLL_MS : null);

  const withConflictNotice = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        // 409: the action no longer applies (a draft already actioned elsewhere, a job that is not retryable, …).
        // The server's envelope message says why; no exact code other than already_handled is relied on.
        if (err instanceof ApiClientError && err.isConflict) {
          setNotice(err.code === "already_handled" ? `Already handled elsewhere. ${err.message}` : err.message);
          return;
        }
        throw err;
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const handleRetryJob = useCallback(() => {
    void run(`retry:${id}`, () =>
      withConflictNotice(async () => {
        await retryMessage(id);
      }),
    );
  }, [id, run, withConflictNotice]);

  const handleApprove = useCallback(
    (draft: ReplyDraftRecord) => {
      void run(`approve:${draft.id}`, () =>
        withConflictNotice(async () => {
          const { draft: result } = await approveReply(draft.id);
          if (result.status === "failed") setNotice(`Slack rejected the reply${result.errorDetail ? `: ${result.errorDetail}` : ""}. Use Retry send.`);
          else if (result.status === "send_uncertain") setNotice("Slack did not confirm the post; checking the thread.");
          else setNotice(null);
        }),
      );
    },
    [run, withConflictNotice],
  );

  const handleRetrySend = useCallback(
    (draft: ReplyDraftRecord) => {
      void run(`retry-send:${draft.id}`, () =>
        withConflictNotice(async () => {
          const { draft: result } = await retrySendReply(draft.id);
          if (result.status === "failed") setNotice(`Slack rejected the reply again${result.errorDetail ? `: ${result.errorDetail}` : ""}.`);
          else setNotice(null);
        }),
      );
    },
    [run, withConflictNotice],
  );

  const handleRegenerate = useCallback(
    (draft: ReplyDraftRecord, tone: ReplyTone) => {
      void run(`regenerate:${draft.id}`, () =>
        withConflictNotice(async () => {
          await regenerateReply(draft.id, tone);
          setNotice(null);
        }),
      );
    },
    [run, withConflictNotice],
  );

  const breadcrumb = (
    <Link href="/history" className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
      <span aria-hidden>←</span> History
    </Link>
  );

  if (loading && !data) {
    return (
      <AppShell breadcrumb={breadcrumb} title="Message">
        <FullPageSpinner label="Loading message…" />
      </AppShell>
    );
  }

  if (!data) {
    const notFound = error instanceof ApiClientError && error.status === 404;
    return (
      <AppShell breadcrumb={breadcrumb} title="Message">
        {notFound ? (
          <EmptyState title="Message not found" action={<Link href="/history" className="text-sm font-medium text-accent-strong underline-offset-2 hover:underline">Back to history</Link>}>
            It may belong to another account or has been deleted.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            <ErrorBanner error={error} />
            <Button variant="secondary" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        )}
      </AppShell>
    );
  }

  const { message, job, artifact, drafts } = data;
  const statusMeta = jobStatusMeta(jobStatus);
  const urgency = urgencyMeta(artifact?.interpretation?.urgency);

  return (
    <AppShell
      wide
      breadcrumb={breadcrumb}
      title={
        <span className="inline-flex flex-wrap items-center gap-3">
          {message.senderDisplayName}
          {message.isMock && <MockBadge size="md" />}
        </span>
      }
      description={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <time dateTime={message.receivedAt} title={formatAbsoluteTime(message.receivedAt)}>
            Received {now ? formatRelativeTime(message.receivedAt, now) : formatAbsoluteTime(message.receivedAt)}
          </time>
          <span aria-hidden>·</span>
          <span>{messageSourceLabel(message.source, message.externalChannelId)}</span>
          {urgency && (
            <Chip tone={urgency.tone} size="sm">
              {urgency.label} urgency
            </Chip>
          )}
          {artifact?.renderMode && artifact.renderMode !== "remotion" && (
            <Chip tone="warning" size="sm" dot={false}>
              {artifact.renderMode.replace("_", " ")}
            </Chip>
          )}
        </span>
      }
      actions={
        <div className="flex items-center gap-3">
          {polling && <span className="hidden text-xs text-ink-faint sm:inline">Live · every 3 s</span>}
          <Chip tone={statusMeta.tone} size="xl" active={Boolean(statusMeta.active)} title={statusMeta.hint}>
            {statusMeta.label}
          </Chip>
        </div>
      }
    >
      <div className="space-y-5">
        {error ? <ErrorBanner error={error} /> : null}
        {actionError ? <ErrorBanner error={actionError} onDismiss={clearError} /> : null}
        {notice && (
          <Banner tone="warning" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        )}

        <JobStatus job={job} onRetry={handleRetryJob} retrying={busyKey === `retry:${id}`} polling={polling} index={0} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <ReelPlayer artifact={artifact} jobStatus={jobStatus} index={1} />
          <div className="space-y-5">
            <OriginalText message={message} index={2} />
            <ActionsList interpretation={artifact?.interpretation ?? null} index={3} />
          </div>
        </div>

        <DraftList drafts={drafts} now={now} busyKey={busyKey} onApprove={handleApprove} onRetrySend={handleRetrySend} onRegenerate={handleRegenerate} index={4} />

        {actionError ? <p className="sr-only">{describeError(actionError)}</p> : null}
      </div>
    </AppShell>
  );
}
