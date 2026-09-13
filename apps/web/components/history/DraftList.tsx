"use client";

import { useState } from "react";
import type { ReplyDraftRecord, ReplyTone } from "@reelrelay/shared";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format";
import { TONE_OPTIONS, replyStatusMeta, toneLabel } from "@/lib/status";
import { AiLabel, Button, Card, Chip, Select } from "@/components/ui";

export interface DraftListProps {
  drafts: ReplyDraftRecord[];
  now: number;
  /** Key of the draft (`<action>:<id>`) whose action is in flight, if any. */
  busyKey: string | null;
  onApprove: (draft: ReplyDraftRecord) => void;
  onRetrySend: (draft: ReplyDraftRecord) => void;
  onRegenerate: (draft: ReplyDraftRecord, tone: ReplyTone) => void;
  index?: number;
}

export function DraftList({ drafts, now, busyKey, onApprove, onRetrySend, onRegenerate, index = 0 }: DraftListProps) {
  return (
    <Card
      eyebrow="Replies"
      title={drafts.length === 0 ? "Reply drafts" : `${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}
      description="Written in your language on Telegram, drafted in English here. Nothing reaches Slack until you approve it."
      index={index}
    >
      {drafts.length === 0 ? (
        <p className="text-sm text-ink-muted">No drafts yet. Tap ✍️ Reply under the reel on Telegram to start one.</p>
      ) : (
        <ul className="space-y-4">
          {drafts.map((draft) => (
            <DraftItem
              key={draft.id}
              draft={draft}
              now={now}
              busyKey={busyKey}
              onApprove={onApprove}
              onRetrySend={onRetrySend}
              onRegenerate={onRegenerate}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function DraftItem({
  draft,
  now,
  busyKey,
  onApprove,
  onRetrySend,
  onRegenerate,
}: {
  draft: ReplyDraftRecord;
  now: number;
  busyKey: string | null;
  onApprove: (draft: ReplyDraftRecord) => void;
  onRetrySend: (draft: ReplyDraftRecord) => void;
  onRegenerate: (draft: ReplyDraftRecord, tone: ReplyTone) => void;
}) {
  const [tone, setTone] = useState<ReplyTone>(draft.tone);
  const meta = replyStatusMeta(draft.status) ?? { label: draft.status, tone: "neutral" as const };
  const busy = busyKey !== null && busyKey.endsWith(`:${draft.id}`);
  const canApprove = draft.status === "draft";
  const canRetrySend = draft.status === "failed" || draft.status === "send_uncertain";
  const canRegenerate = draft.status === "draft" || draft.status === "failed" || draft.status === "cancelled";
  const warnings = draft.warnings ?? [];

  return (
    <li className="rounded-2xl border border-line bg-surface-muted p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Chip tone={meta.tone} size="lg" active={Boolean(meta.active)} title={meta.hint}>
            {meta.label}
          </Chip>
          <span className="text-sm text-ink-muted">{toneLabel(draft.tone)}</span>
        </div>
        <time dateTime={draft.createdAt} title={formatAbsoluteTime(draft.createdAt)} className="text-xs tabular-nums text-ink-faint">
          {now ? formatRelativeTime(draft.createdAt, now) : formatAbsoluteTime(draft.createdAt)}
        </time>
      </div>

      <dl className="mt-4 space-y-3">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">你写的 · Your input</dt>
          <dd className="mt-1 whitespace-pre-wrap text-[15px] leading-7 text-ink">{draft.userInputOriginal}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">English draft</dt>
          <dd className="mt-1 whitespace-pre-wrap text-[15px] leading-7 text-ink">{draft.draftEnglish}</dd>
        </div>
        {draft.meaningCheck && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">意思核对 · Meaning check</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-muted">{draft.meaningCheck}</dd>
          </div>
        )}
      </dl>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-warning">
          {warnings.map((warning, i) => (
            <li key={`${i}-${warning}`}>⚠️ {warning}</li>
          ))}
        </ul>
      )}

      {draft.errorDetail && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 font-mono text-xs text-danger">{draft.errorDetail}</p>
      )}

      {draft.status === "sent" && (
        <p className="mt-3 text-sm text-success">
          Sent ✅ in the thread under the sender&apos;s message
          {draft.sentExternalMessageId && <span className="ml-1 font-mono text-xs text-ink-faint">· ts {draft.sentExternalMessageId}</span>}
        </p>
      )}
      {draft.status === "send_uncertain" && <p className="mt-3 text-sm text-warning">Slack did not confirm the post. Checking the thread; retry if it does not appear.</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <AiLabel>AI-assisted draft — review before sending</AiLabel>
        <div className="flex flex-wrap items-center gap-2">
          {canRegenerate && (
            <>
              <Select
                aria-label="Tone for the regenerated draft"
                value={tone}
                onChange={(event) => setTone(event.target.value as ReplyTone)}
                disabled={busy}
                className="h-9 w-auto text-[13px]"
              >
                {TONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" size="sm" onClick={() => onRegenerate(draft, tone)} loading={busyKey === `regenerate:${draft.id}`} disabled={busy}>
                Regenerate
              </Button>
            </>
          )}
          {canRetrySend && (
            <Button size="md" onClick={() => onRetrySend(draft)} loading={busyKey === `retry-send:${draft.id}`} disabled={busy}>
              Retry send
            </Button>
          )}
          {canApprove && (
            <Button size="md" onClick={() => onApprove(draft)} loading={busyKey === `approve:${draft.id}`} disabled={busy}>
              Approve &amp; send
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
