// Pivot 03: the Triage Router. Pure; no I/O. Context in, delivery plan out.
import type { DeliveryPlan, DeliveryReason, MessageInterpretation, ReplyTone, SenderRelationship, UserPreferences } from "@reelrelay/shared";

export type DecideDeliveryInput = {
  interpretation: MessageInterpretation;
  relationship: SenderRelationship;
  prefs: UserPreferences;
  now: Date;
};

export const DIGEST_SLOTS = ["08:00", "18:00"] as const;
const AUTHORITY: ReadonlySet<SenderRelationship> = new Set(["professor", "employer", "landlord"]);

/* ───────────── time helpers (IANA timezone, no library) ───────────── */

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}
/** Offset of `timeZone` from UTC at `date`, in minutes. */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}
/** Instant for the local wall-clock time (y, m, d, HH:mm) in `timeZone`. DST transitions are ignored (±1 h at worst). */
export function zonedInstant(timeZone: string, year: number, month: number, day: number, hhmm: string, reference: Date): Date {
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hh, mm, 0);
  return new Date(naive - offsetMinutes(reference, timeZone) * 60000);
}
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number) as [number, number]; return h * 60 + m; };
export function formatLocalTime(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
/** True when the local clock is inside [start, end), with wrap over midnight (22:00–08:00). */
export function inQuietHours(localHHmm: string, start: string, end: string): boolean {
  const t = toMinutes(localHHmm), s = toMinutes(start), e = toMinutes(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}
/** Next occurrence of local `hhmm` strictly after `now` (today if still ahead, else tomorrow). */
export function nextLocalTime(now: Date, timeZone: string, hhmm: string): Date {
  const p = localParts(now, timeZone);
  const today = zonedInstant(timeZone, p.year, p.month, p.day, hhmm, now);
  if (today.getTime() > now.getTime()) return today;
  return new Date(today.getTime() + 24 * 3600 * 1000);
}
export function nextDigestSlot(now: Date, timeZone: string): Date {
  return DIGEST_SLOTS.map((slot) => nextLocalTime(now, timeZone, slot)).sort((a, b) => a.getTime() - b.getTime())[0]!;
}

/* ───────────── context extraction ───────────── */

/** Hours until the nearest essential deadline with a parseable dueAt; null when none. */
export function hoursToNearestDeadline(interp: MessageInterpretation, now: Date): number | null {
  let nearest: number | null = null;
  for (const item of interp.actionItems) {
    if (!item.essential || !item.dueAt) continue;
    const at = Date.parse(item.dueAt);
    if (Number.isNaN(at)) continue;
    const hours = (at - now.getTime()) / 3600000;
    if (nearest === null || hours < nearest) nearest = hours;
  }
  return nearest;
}
/** An essential item names a deadline in words but the engine could not pin it to an instant. */
export function hasUnresolvedDeadline(interp: MessageInterpretation): boolean {
  return interp.actionItems.some((item) => item.essential && item.dueText && !item.dueAt);
}
export function toneForRelationship(relationship: SenderRelationship, fallback: ReplyTone): ReplyTone {
  if (AUTHORITY.has(relationship)) return "respectful_student";
  if (relationship === "peer") return "warm";
  return fallback;
}

/* ───────────── reason text (student's language) ───────────── */

function friendlyTime(date: Date, timeZone: string, lang: string): string {
  return new Intl.DateTimeFormat(lang.startsWith("zh") ? "zh-CN" : "en-CA", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}
function reasonText(mode: DeliveryPlan["mode"], reasons: DeliveryReason[], lang: string, deliverAfter: Date | null, timeZone: string, hours: number | null): string {
  const zh = lang.startsWith("zh");
  const when = deliverAfter ? friendlyTime(deliverAfter, timeZone, lang) : "";
  const h = hours === null ? null : Math.max(0, Math.round(hours));
  if (mode === "instant") {
    const why: string[] = [];
    if (reasons.includes("urgency_high")) why.push(zh ? "紧急" : "high urgency");
    if (reasons.includes("deadline_within_24h")) why.push(zh ? `${h} 小时内截止` : `deadline in ${h} h`);
    if (reasons.includes("sensitive_from_authority")) why.push(zh ? "重要事项" : "sensitive topic");
    return zh ? `已立即发送：${why.join("，")}。完整视频稍后送达。` : `Sent right away: ${why.join(", ")}. Full reel follows.`;
  }
  if (mode === "reel") {
    if (reasons.includes("quiet_hours")) return zh ? `已保留到 ${when}：处于你的免打扰时段。` : `Held until ${when}: outside your quiet hours.`;
    return zh ? "正常发送：中等优先级。" : "Delivered normally: medium priority.";
  }
  return zh ? `已并入你 ${when} 的摘要：优先级低，暂无临近截止。` : `Bundled into your ${when} digest: low urgency, no deadline soon.`;
}

/* ───────────── the router ───────────── */

export function decideDelivery(input: DecideDeliveryInput): DeliveryPlan {
  const { interpretation, relationship, prefs, now } = input;
  const timezone = prefs.timezone;
  const localTime = formatLocalTime(now, timezone);
  const quiet = inQuietHours(localTime, prefs.quietStart, prefs.quietEnd);
  const hours = hoursToNearestDeadline(interpretation, now);
  const reasons: DeliveryReason[] = [];
  let mode: DeliveryPlan["mode"];
  let deliverAfter: Date | null = null;

  // R1 — interrupt now, quiet hours ignored.
  if (interpretation.urgency === "high") reasons.push("urgency_high");
  if (hours !== null && hours < 24) reasons.push("deadline_within_24h");
  if (interpretation.isSensitive && AUTHORITY.has(relationship)) reasons.push("sensitive_from_authority");
  if (reasons.length) {
    mode = "instant";
  } else {
    // R2 — reel now, or held until quiet hours end.
    const soon = hours !== null && hours < 72;
    const unknown = hasUnresolvedDeadline(interpretation);
    if (interpretation.urgency === "medium" || soon || unknown) {
      mode = "reel";
      if (interpretation.urgency === "medium") reasons.push("urgency_medium");
      if (soon) reasons.push("deadline_within_72h");
      if (unknown) reasons.push("deadline_unknown");
      if (quiet) { reasons.push("quiet_hours"); deliverAfter = nextLocalTime(now, timezone, prefs.quietEnd); }
    } else {
      // R3 — low urgency, nothing due: next digest slot.
      mode = "digest";
      reasons.push("urgency_low", "digest_slot");
      deliverAfter = nextDigestSlot(now, timezone);
    }
  }
  return {
    mode,
    deliverAfter: deliverAfter ? deliverAfter.toISOString() : null,
    reasons: reasons.slice(0, 4),
    reasonText: reasonText(mode, reasons, prefs.targetLanguage, deliverAfter, timezone, hours),
    replyTone: toneForRelationship(relationship, prefs.replyTone),
    context: { urgency: interpretation.urgency, hoursToDeadline: hours === null ? null : Math.round(hours * 10) / 10, relationship, localTime, timezone, inQuietHours: quiet },
  };
}
