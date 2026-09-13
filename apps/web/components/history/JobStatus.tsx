"use client";

import type { MessageDetailResponse } from "@reelrelay/shared";
import { formatAbsoluteTime, formatMs, formatSeconds } from "@/lib/format";
import { deliveryModeMeta, isJobTerminal, jobStatusMeta, orderedStageTimings, relationshipLabel, toneLabel } from "@/lib/status";
import { Button, Card, Chip, KeyValue } from "@/components/ui";

export interface JobStatusProps {
  job: MessageDetailResponse["job"];
  onRetry: () => void;
  retrying: boolean;
  /** Pivot 03: release a held job. */
  onDeliverNow?: () => void;
  releasing?: boolean;
  polling: boolean;
  index?: number;
}

/** Job state, per-stage timings in milliseconds, the error when it failed, and Retry. */
export function JobStatus({ job, onRetry, retrying, onDeliverNow, releasing = false, polling, index = 0 }: JobStatusProps) {
  const status = job?.status ?? "queued";
  const meta = jobStatusMeta(status);
  const plan = job?.deliveryPlan ?? null;
  const mode = deliveryModeMeta(plan?.mode);
  const timings = orderedStageTimings(job?.stageTimings ?? {});
  const total = timings.reduce((sum, [, ms]) => sum + ms, 0);
  const canRetry = status === "failed" && (job?.attemptCount ?? 0) < 3;

  return (
    <Card
      eyebrow="Pipeline"
      title="Job status"
      action={
        <Chip tone={meta.tone} size="xl" active={Boolean(meta.active)} title={meta.hint}>
          {meta.label}
        </Chip>
      }
      index={index}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-4">
            <KeyValue label="Attempts" mono>
              {job ? `${job.attemptCount} / 3` : "—"}
            </KeyValue>
            <KeyValue label="Job id" mono>
              {job ? job.id.slice(0, 8) : "—"}
            </KeyValue>
            <KeyValue label="Started">{job?.startedAt ? formatAbsoluteTime(job.startedAt) : "—"}</KeyValue>
            <KeyValue label="Completed">{job?.completedAt ? formatAbsoluteTime(job.completedAt) : "—"}</KeyValue>
          </dl>

          {status === "failed" && (
            <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <p className="font-semibold">{job?.errorCode ?? "FAILED"}</p>
              {job?.errorDetail && <p className="mt-1 break-words font-mono text-xs">{job.errorDetail}</p>}
            </div>
          )}

          {plan && mode && (
            <div className="space-y-2 rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Triage</p>
                <Chip tone={mode.tone} size="md" dot={false} title={mode.hint}>
                  {mode.label}
                </Chip>
              </div>
              <p className="text-ink">{plan.reasonText}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-muted sm:grid-cols-3">
                <div><dt className="text-ink-faint">Urgency</dt><dd className="capitalize">{plan.context.urgency}</dd></div>
                <div><dt className="text-ink-faint">Deadline</dt><dd>{plan.context.hoursToDeadline === null ? "none pinned" : `in ${plan.context.hoursToDeadline} h`}</dd></div>
                <div><dt className="text-ink-faint">Sender</dt><dd>{relationshipLabel(plan.context.relationship)}</dd></div>
                <div><dt className="text-ink-faint">Local time</dt><dd className="font-mono">{plan.context.localTime}{plan.context.inQuietHours ? " · quiet" : ""}</dd></div>
                <div><dt className="text-ink-faint">Reply tone</dt><dd>{toneLabel(plan.replyTone)}</dd></div>
                <div><dt className="text-ink-faint">Delivers</dt><dd>{job?.deliverAfter && status === "held" ? formatAbsoluteTime(job.deliverAfter) : plan.deliverAfter ? formatAbsoluteTime(plan.deliverAfter) : "immediately"}</dd></div>
              </dl>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {status === "held" && onDeliverNow && (
              <Button onClick={onDeliverNow} loading={releasing} size="lg" variant="secondary">
                Deliver now
              </Button>
            )}
            {status === "failed" && (
              <Button onClick={onRetry} loading={retrying} disabled={!canRetry} size="lg">
                Retry
              </Button>
            )}
            {status === "failed" && !canRetry && <span className="text-sm text-ink-muted">Retry limit reached.</span>}
            {!isJobTerminal(status) && (
              <span className="text-sm text-ink-muted">
                {meta.hint}
                {polling ? " · refreshing every 3 s" : ""}
              </span>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Stage timings</p>
          {timings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-sm text-ink-muted">No stages have finished yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Stage
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Milliseconds
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Seconds
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {timings.map(([stage, ms]) => (
                    <tr key={stage} className="border-t border-line">
                      <td className="px-3 py-2 capitalize text-ink">{stage.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{formatMs(ms)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">{formatSeconds(ms)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line-strong bg-surface-muted font-medium">
                    <td className="px-3 py-2 text-ink">Total</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{formatMs(total)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">{formatSeconds(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
