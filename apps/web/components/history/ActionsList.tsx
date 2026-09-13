"use client";

import type { MessageInterpretation } from "@reelrelay/shared";
import { urgencyMeta } from "@/lib/status";
import { Card, Chip } from "@/components/ui";

export interface ActionsListProps {
  interpretation: MessageInterpretation | null;
  index?: number;
}

/** Every action item with its due text and verbatim evidence; negations are marked; ambiguities follow. */
export function ActionsList({ interpretation, index = 0 }: ActionsListProps) {
  const items = interpretation?.actionItems ?? [];
  const ambiguities = interpretation?.ambiguities ?? [];
  const urgency = urgencyMeta(interpretation?.urgency);

  return (
    <Card
      eyebrow="Actions"
      title={items.length === 0 ? "Action items" : `${items.length} action item${items.length === 1 ? "" : "s"}`}
      action={
        urgency ? (
          <Chip tone={urgency.tone} size="md">
            {urgency.label} urgency
          </Chip>
        ) : undefined
      }
      index={index}
    >
      {!interpretation ? (
        <p className="text-sm text-ink-muted">Actions appear once the message has been analyzed.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">No action items were found in this message.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((item, i) => (
            <li
              key={`${i}-${item.evidenceQuote}`}
              className={`rounded-xl border px-4 py-3 ${item.isNegation ? "border-danger/30 bg-danger-soft/40" : "border-line bg-surface-muted"}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 font-mono text-xs tabular-nums text-ink-faint">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium leading-6 text-ink">
                    {item.isNegation && (
                      <span aria-label="Do not" className="mr-1.5">
                        🚫
                      </span>
                    )}
                    {item.text}
                  </p>
                  {item.textEnglish && item.textEnglish !== item.text && <p className="mt-0.5 text-sm text-ink-muted">{item.textEnglish}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {item.dueText && (
                      <span className="inline-flex items-center gap-1 font-medium text-ink">
                        <span aria-label="Due">📅</span> {item.dueText}
                      </span>
                    )}
                    {item.essential && (
                      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-strong">Essential</span>
                    )}
                  </div>
                  <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm italic text-ink-muted">“{item.evidenceQuote}”</blockquote>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {ambiguities.length > 0 && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
          <p className="text-sm font-semibold text-warning">⚠️ Unclear</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {ambiguities.map((text, i) => (
              <li key={`${i}-${text}`}>{text}</li>
            ))}
          </ul>
        </div>
      )}

      {interpretation && interpretation.preservedFacts.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-3">
          {interpretation.preservedFacts.map((fact, i) => (
            <div key={`${i}-${fact.label}`} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{fact.label}</dt>
              <dd className="mt-0.5 break-words text-sm text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
