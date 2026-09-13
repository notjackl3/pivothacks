"use client";

import type { ReactNode } from "react";

export type StepState = "done" | "todo" | "warning";

export interface SetupStep {
  key: string;
  label: string;
  detail?: ReactNode;
  state: StepState;
}

const STATE_STYLE: Record<StepState, { circle: string; text: string; glyph: string }> = {
  done: { circle: "bg-success text-white border-success", text: "text-ink", glyph: "✓" },
  warning: { circle: "bg-warning-soft text-warning border-warning/50", text: "text-ink", glyph: "!" },
  todo: { circle: "bg-surface text-ink-faint border-line-strong", text: "text-ink-muted", glyph: "" },
};

/** The four setup steps with their completion state; doubles as the page's progress header. */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((step) => step.state === "done").length;
  const complete = done === steps.length;

  return (
    <div className="rr-rise rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Setup progress</p>
        <p className={`text-sm font-medium tabular-nums ${complete ? "text-success" : "text-ink-muted"}`}>
          {complete ? "Ready — send a Slack DM to see it relay" : `${done} of ${steps.length} done`}
        </p>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const style = STATE_STYLE[step.state];
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span
                aria-hidden
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${style.circle}`}
              >
                {style.glyph || index + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${style.text}`}>
                  <span className="sr-only">
                    {step.state === "done" ? "Done: " : step.state === "warning" ? "Needs attention: " : "To do: "}
                  </span>
                  {step.label}
                </p>
                {step.detail && <p className="mt-0.5 truncate text-xs text-ink-faint">{step.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
