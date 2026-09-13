import type {
  ConnectionMode,
  DeliveryMode,
  JobStatus,
  MessageDetailResponse,
  MessageListItem,
  RenderMode,
  ReplyDraftStatus,
  ReplyTone,
  SenderRelationship,
} from "@reelrelay/shared";

export type ChipTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface StatusMeta {
  label: string;
  tone: ChipTone;
  /** Animated dot: the state is still moving. */
  active?: boolean;
  hint?: string;
}

export const JOB_STATUS_META: Record<JobStatus, StatusMeta> = {
  queued: { label: "Queued", tone: "neutral", active: true, hint: "Waiting for the worker" },
  analyzing: { label: "Analyzing", tone: "accent", active: true, hint: "Interpreting the message" },
  notifying: { label: "Instant card", tone: "warning", active: true, hint: "Urgent: sending the actions before the reel" },
  voicing: { label: "Voicing", tone: "accent", active: true, hint: "Generating narration" },
  rendering: { label: "Rendering", tone: "accent", active: true, hint: "Rendering the reel" },
  held: { label: "Held", tone: "warning", hint: "Rendered; waiting for quiet hours to end or the digest slot" },
  delivering: { label: "Delivering", tone: "accent", active: true, hint: "Sending to Telegram" },
  complete: { label: "Delivered", tone: "success", hint: "Reel delivered to Telegram" },
  failed: { label: "Failed", tone: "danger", hint: "Processing failed" },
};

/** `held` counts as settled for polling: it only moves when the scheduler releases it (or Deliver now is pressed, which refreshes). */
const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set<JobStatus>(["complete", "failed", "held"]);

export function jobStatusMeta(status: string | null | undefined): StatusMeta {
  if (!status) return JOB_STATUS_META.queued;
  return JOB_STATUS_META[status as JobStatus] ?? { label: status, tone: "neutral" };
}

/** True when the job will not change without user action. A missing status counts as still moving. */
export function isJobTerminal(status: string | null | undefined): boolean {
  return Boolean(status) && TERMINAL_JOB_STATUSES.has(status as string);
}

export function anyJobActive(items: readonly Pick<MessageListItem, "jobStatus">[]): boolean {
  return items.some((item) => !isJobTerminal(item.jobStatus));
}

export const REPLY_STATUS_META: Record<ReplyDraftStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral", hint: "Waiting for your approval" },
  approved: { label: "Sending", tone: "accent", active: true, hint: "Approved, posting to Slack" },
  sent: { label: "Sent", tone: "success", hint: "Posted in the Slack thread" },
  send_uncertain: { label: "Checking", tone: "warning", active: true, hint: "Slack did not confirm; reconciling" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Send failed", tone: "danger", hint: "Slack rejected the reply" },
};

export function replyStatusMeta(status: string | null | undefined): StatusMeta | null {
  if (!status) return null;
  return REPLY_STATUS_META[status as ReplyDraftStatus] ?? { label: status, tone: "neutral" };
}

export const URGENCY_META: Record<"low" | "medium" | "high", StatusMeta> = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "warning" },
  high: { label: "High", tone: "danger" },
};

export function urgencyMeta(urgency: string | null | undefined): StatusMeta | null {
  if (!urgency) return null;
  return URGENCY_META[urgency as keyof typeof URGENCY_META] ?? { label: urgency, tone: "neutral" };
}

export const RENDER_MODE_NOTE: Record<RenderMode, string | null> = {
  remotion: null,
  captions_only: "Captions only — narration was unavailable, so this reel plays silently with captions.",
  text_only: "Text-only card — the video could not be rendered, so Telegram received a text card with the hook, narration and all actions.",
};

export interface LanguageOption {
  value: string;
  label: string;
  tested: boolean;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "zh-CN", label: "Simplified Chinese — tested", tested: true },
  { value: "vi", label: "Vietnamese (untested)", tested: false },
  { value: "ko", label: "Korean (untested)", tested: false },
  { value: "es", label: "Spanish (untested)", tested: false },
  { value: "fr", label: "French (untested)", tested: false },
];

export function languageLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return LANGUAGE_OPTIONS.find((option) => option.value === value)?.label.replace(/ — tested| \(untested\)/, "") ?? value;
}

export const TONE_OPTIONS: { value: ReplyTone; label: string }[] = [
  { value: "respectful_student", label: "Respectful student" },
  { value: "concise_professional", label: "Concise professional" },
  { value: "warm", label: "Warm" },
  { value: "direct", label: "Direct" },
];

// ───────────────────────────── Pivot 03: context ─────────────────────────────

export const RELATIONSHIP_OPTIONS: { value: SenderRelationship; label: string; hint: string }[] = [
  { value: "professor", label: "Professor / TA", hint: "Formal narration; respectful student replies" },
  { value: "employer", label: "Employer / manager", hint: "Formal narration; shifts and pay are essential" },
  { value: "landlord", label: "Landlord", hint: "Formal; rent and notices are sensitive, sent instantly" },
  { value: "peer", label: "Classmate / friend", hint: "Casual narration; warm replies" },
  { value: "other", label: "Other", hint: "Uses your reply tone preference" },
];

export function relationshipLabel(value: string | null | undefined): string {
  if (!value) return "Other";
  return RELATIONSHIP_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export const DELIVERY_MODE_META: Record<DeliveryMode, StatusMeta> = {
  instant: { label: "⚡ Instant", tone: "danger", hint: "Actions sent as a text card within seconds; the reel followed" },
  reel: { label: "🎬 Reel", tone: "accent", hint: "Normal path: rendered, then delivered" },
  digest: { label: "☀️ Digest", tone: "neutral", hint: "Low urgency: bundled into the next 8 AM / 6 PM digest" },
};

export function deliveryModeMeta(mode: string | null | undefined): StatusMeta | null {
  if (!mode) return null;
  return DELIVERY_MODE_META[mode as DeliveryMode] ?? { label: mode, tone: "neutral" };
}

export function toneLabel(tone: string | null | undefined): string {
  if (!tone) return "—";
  return TONE_OPTIONS.find((option) => option.value === tone)?.label ?? tone;
}

export function connectionModeLabel(mode: ConnectionMode): string {
  return mode === "bot_token" ? "posts as the bot, on your behalf" : "posts as you";
}

/** Stage order for the timings table; unknown stages are appended alphabetically. */
export const STAGE_ORDER: readonly string[] = ["queued", "analyzing", "notifying", "voicing", "rendering", "delivering"];

export function orderedStageTimings(timings: Record<string, number>): [string, number][] {
  const entries = Object.entries(timings).filter(([, value]) => typeof value === "number" && Number.isFinite(value));
  return entries.sort(([a], [b]) => {
    const ia = STAGE_ORDER.indexOf(a);
    const ib = STAGE_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** "Injected fixture" for demo rows; otherwise Slack, telling DMs (D…) from channels (C…/G…, bot mode) by the channel id. */
export function messageSourceLabel(source: MessageDetailResponse["message"]["source"], externalChannelId: string): string {
  if (source === "mock") return "Injected fixture";
  return externalChannelId.startsWith("D") ? "Slack DM" : "Slack channel";
}
