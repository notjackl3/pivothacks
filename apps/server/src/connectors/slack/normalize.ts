// Dev B. Slack event → NormalizedMessage (PLAN.md §8). Pure.
import type { NormalizedMessage } from "@reelrelay/shared";
import { filterSlackEnvelope } from "./filter.js";

/** `${channel}:${ts}` (PLAN.md §4.3 step 7). */
export function externalMessageIdFor(channel: string, ts: string): string {
  return `${channel}:${ts}`;
}

/** The Slack ts to thread replies under: externalThreadId when the message is inside a thread, else the message's own ts. */
export function parentTs(externalMessageId: string, externalThreadId: string | null): string {
  if (typeof externalThreadId === "string" && externalThreadId.length > 0) return externalThreadId;
  // Neither channel ids nor ts values contain ':', so the last separator is the boundary.
  const sep = externalMessageId.lastIndexOf(":");
  return sep >= 0 ? externalMessageId.slice(sep + 1) : externalMessageId;
}

/** "1757772131.000200" → ISO 8601. The fractional part is Slack's uniqueness suffix; only its first 3 digits are ms. */
export function slackTsToIso(ts: string): string {
  if (typeof ts !== "string" || !/^\d+(\.\d*)?$/.test(ts)) throw new Error(`invalid_slack_ts:${String(ts).slice(0, 40)}`);
  const [secondsPart, fractionPart = ""] = ts.split(".");
  const seconds = Number(secondsPart);
  // Integer arithmetic on the digits avoids float drift (e.g. 0.0002 * 1000).
  const millis = Number(`${fractionPart}000`.slice(0, 3));
  const date = new Date(seconds * 1000 + millis);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid_slack_ts:${ts.slice(0, 40)}`);
  return date.toISOString();
}

/**
 * Builds the NormalizedMessage for an accepted envelope. Returns null when the payload is not a usable message event.
 * senderDisplayName comes from ctx (the tracked entity's display_name); connectionId from ctx.
 *
 * Channel gating (im vs channel) is the webhook's decision, so this accepts channel events too.
 */
export function normalizeSlackEvent(
  payload: unknown,
  ctx: { connectionId: string; senderDisplayName: string },
): NormalizedMessage | null {
  const filtered = filterSlackEnvelope(payload, { allowChannels: true });
  if (!filtered.ok) return null;
  const { event } = filtered;

  let receivedAt: string;
  try {
    receivedAt = slackTsToIso(event.ts);
  } catch {
    return null;
  }

  // A thread parent may carry thread_ts === ts once it has replies; that is not "inside a thread".
  const externalThreadId = event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : null;

  return {
    provider: "slack",
    connectionId: ctx.connectionId,
    externalMessageId: externalMessageIdFor(event.channel, event.ts),
    externalChannelId: event.channel,
    externalThreadId,
    senderExternalId: event.user,
    senderDisplayName: ctx.senderDisplayName,
    text: event.text,
    receivedAt,
  };
}
