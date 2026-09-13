"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MessageListItem } from "@reelrelay/shared";
import { listMessages } from "@/lib/api";
import { useInterval, useNow, useResource } from "@/lib/hooks";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format";
import { anyJobActive, jobStatusMeta, replyStatusMeta, urgencyMeta } from "@/lib/status";
import { AppShell } from "@/components/AppShell";
import { Button, Chip, EmptyState, ErrorBanner, FullPageSpinner, LinkButton, MockBadge } from "@/components/ui";

const POLL_MS = 3000;

export function HistoryView() {
  const loader = useCallback(() => listMessages(50), []);
  const { data, error, loading, refresh } = useResource(loader);
  const now = useNow();
  const items = data?.items ?? [];
  const polling = anyJobActive(items);

  useInterval(() => {
    void refresh();
  }, polling ? POLL_MS : null);

  return (
    <AppShell
      wide
      title="History"
      description="Every relayed message, newest first. Open one for the reel, the original text, the actions and the reply drafts."
      actions={
        <>
          {polling ? (
            <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
              <span aria-hidden className="rr-pulse inline-block h-2 w-2 rounded-full bg-accent" />
              Live · every 3 s
            </span>
          ) : (
            <span className="text-sm text-ink-faint">Idle</span>
          )}
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
        </>
      }
    >
      {error ? <ErrorBanner error={error} className="mb-4" /> : null}

      {loading && !data ? (
        <FullPageSpinner label="Loading history…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing relayed yet"
          action={
            <LinkButton href="/setup" variant="primary">
              Check setup
            </LinkButton>
          }
        >
          When your tracked sender DMs you on Slack, the message shows up here within seconds and moves through Analyzing, Voicing, Rendering and
          Delivering.
        </EmptyState>
      ) : (
        <>
          <DesktopTable items={items} now={now} />
          <MobileList items={items} now={now} />
        </>
      )}
    </AppShell>
  );
}

function ReceivedTime({ iso, now }: { iso: string; now: number }) {
  return (
    <time dateTime={iso} title={formatAbsoluteTime(iso)} className="tabular-nums">
      {now ? formatRelativeTime(iso, now) : formatAbsoluteTime(iso)}
    </time>
  );
}

function DesktopTable({ items, now }: { items: MessageListItem[]; now: number }) {
  const router = useRouter();
  return (
    <div className="rr-rise hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-card md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-surface-muted text-[11px] uppercase tracking-[0.12em] text-ink-faint">
            <tr>
              <th scope="col" className="px-5 py-3 text-left font-semibold">
                Sender
              </th>
              <th scope="col" className="px-3 py-3 text-left font-semibold">
                Message
              </th>
              <th scope="col" className="px-3 py-3 text-left font-semibold">
                Urgency
              </th>
              <th scope="col" className="px-3 py-3 text-left font-semibold">
                Status
              </th>
              <th scope="col" className="px-3 py-3 text-left font-semibold">
                Reply
              </th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">
                Received
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const status = jobStatusMeta(item.jobStatus);
              const reply = replyStatusMeta(item.replyStatus);
              const urgency = urgencyMeta(item.urgency);
              const href = `/history/${item.id}`;
              return (
                <tr
                  key={item.id}
                  onClick={() => router.push(href)}
                  className="cursor-pointer border-t border-line transition-colors hover:bg-surface-muted"
                >
                  <td className="px-5 py-4 align-middle">
                    <Link href={href} className="font-medium text-ink hover:underline underline-offset-2" onClick={(event) => event.stopPropagation()}>
                      {item.sender}
                    </Link>
                    {item.isMock && <MockBadge className="ml-2 align-middle" />}
                  </td>
                  <td className="max-w-[360px] px-3 py-4 align-middle">
                    <p className="truncate text-ink-muted" title={item.preview}>
                      {item.preview}
                    </p>
                    {item.hasVideo && <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-ink-faint">Video ready</p>}
                  </td>
                  <td className="px-3 py-4 align-middle">
                    {urgency ? (
                      <Chip tone={urgency.tone} size="md">
                        {urgency.label}
                      </Chip>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-4 align-middle">
                    <Chip tone={status.tone} size="lg" active={Boolean(status.active)} title={status.hint}>
                      {status.label}
                    </Chip>
                  </td>
                  <td className="px-3 py-4 align-middle">
                    {reply ? (
                      <Chip tone={reply.tone} size="md" active={Boolean(reply.active)} title={reply.hint}>
                        {reply.label}
                      </Chip>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right align-middle text-ink-muted">
                    <ReceivedTime iso={item.receivedAt} now={now} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MobileList({ items, now }: { items: MessageListItem[]; now: number }) {
  return (
    <ul className="space-y-3 md:hidden">
      {items.map((item, index) => {
        const status = jobStatusMeta(item.jobStatus);
        const reply = replyStatusMeta(item.replyStatus);
        const urgency = urgencyMeta(item.urgency);
        return (
          <li key={item.id} className="rr-rise" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
            <Link href={`/history/${item.id}`} className="block rounded-2xl border border-line bg-surface p-4 shadow-card active:bg-surface-muted">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {item.sender}
                    {item.isMock && <MockBadge className="ml-2 align-middle" />}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{item.preview}</p>
                </div>
                <span className="shrink-0 text-xs text-ink-faint">
                  <ReceivedTime iso={item.receivedAt} now={now} />
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone={status.tone} size="lg" active={Boolean(status.active)} title={status.hint}>
                  {status.label}
                </Chip>
                {urgency && (
                  <Chip tone={urgency.tone} size="sm">
                    {urgency.label}
                  </Chip>
                )}
                {reply && (
                  <Chip tone={reply.tone} size="sm" active={Boolean(reply.active)}>
                    {reply.label}
                  </Chip>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
