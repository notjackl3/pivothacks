"use client";

import type { MessageDetailResponse } from "@reelrelay/shared";
import { formatSeconds } from "@/lib/format";
import { RENDER_MODE_NOTE } from "@/lib/status";
import { AiLabel, Banner, Card } from "@/components/ui";

export interface ReelPlayerProps {
  artifact: MessageDetailResponse["artifact"];
  jobStatus: string;
  index?: number;
}

/** The rendered reel (when there is one) with the render-mode note and the AI-assisted label. */
export function ReelPlayer({ artifact, jobStatus, index = 0 }: ReelPlayerProps) {
  const videoUrl = artifact?.videoUrl ?? null;
  const note = artifact ? RENDER_MODE_NOTE[artifact.renderMode] ?? null : null;

  return (
    <Card eyebrow="Reel" title="What was delivered" action={<AiLabel>AI-assisted translation</AiLabel>} index={index}>
      <div className="space-y-4">
        {videoUrl ? (
          <div className="mx-auto w-full max-w-[300px]">
            <div className="overflow-hidden rounded-2xl border border-line bg-black shadow-card" style={{ aspectRatio: "9 / 16" }}>
              <video controls playsInline preload="metadata" src={videoUrl} className="h-full w-full object-contain">
                Your browser cannot play this video.
              </video>
            </div>
            {artifact?.durationMs != null && (
              <p className="mt-2 text-center font-mono text-xs tabular-nums text-ink-faint">{formatSeconds(artifact.durationMs)} · 720×1280</p>
            )}
          </div>
        ) : artifact ? (
          <div className="rounded-xl border border-dashed border-line-strong bg-surface-muted px-4 py-8 text-center text-sm text-ink-muted">
            {artifact.renderMode === "text_only" ? "No video for this message — a text card was delivered instead." : "Video not available."}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line-strong bg-surface-muted px-4 py-8 text-center text-sm text-ink-muted">
            {jobStatus === "failed" ? "The reel was not produced." : "The reel is still being produced."}
          </div>
        )}

        {note && <Banner tone="warning">{note}</Banner>}

        {artifact?.interpretation && (
          <div className="space-y-3 border-t border-line pt-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Hook</p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-ink">{artifact.interpretation.hook}</p>
              <p className="text-sm text-ink-muted">{artifact.interpretation.shortTitle}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Faithful translation</p>
              <p className="mt-1 whitespace-pre-wrap text-[15px] leading-7 text-ink">{artifact.interpretation.faithfulTranslation}</p>
            </div>
            <p className="text-xs text-ink-faint">
              Sender intent: <span className="text-ink-muted">{artifact.interpretation.senderIntent}</span>
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
