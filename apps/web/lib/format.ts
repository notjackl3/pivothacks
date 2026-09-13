const relativeFormatter =
  typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl
    ? new Intl.RelativeTimeFormat("en", { numeric: "auto" })
    : null;

/** "just now", "42 s ago", "5 min ago", "3 h ago", "yesterday", or a short date for older items. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diffMs = then - now;
  const abs = Math.abs(diffMs);
  const sec = Math.round(abs / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec} s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day < 7 && relativeFormatter) return relativeFormatter.format(-day, "day");
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatAbsoluteTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  return new Date(then).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Integer milliseconds with thousands separators: 11842 → "11,842 ms". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

/** Seconds with one decimal: 11842 → "11.8 s". */
export function formatSeconds(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(1)} s`;
}

/** m:ss countdown from a millisecond remainder (never negative). */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Extracts the bot username from a `https://t.me/<bot>?start=<code>` deep link. */
export function botUsernameFromDeepLink(deepLink: string): string | null {
  try {
    const url = new URL(deepLink);
    const segment = url.pathname.replace(/^\/+/, "").split("/")[0];
    return segment ? segment : null;
  } catch {
    return null;
  }
}

/**
 * Slack `thread_ts` to show for a stored message: the parent thread when the message is a reply, else the
 * message's own ts (`externalMessageId` is `${channel}:${ts}`). Null when the id carries no ts.
 */
export function slackThreadTs(message: { externalThreadId: string | null; externalMessageId: string }): string | null {
  if (message.externalThreadId) return message.externalThreadId;
  const separator = message.externalMessageId.indexOf(":");
  if (separator === -1) return null;
  return message.externalMessageId.slice(separator + 1) || null;
}
