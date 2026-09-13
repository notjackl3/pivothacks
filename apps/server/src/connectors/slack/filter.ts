// Dev B. Pure pre-storage filter (PLAN.md §4.3 step 4, §10). No I/O; DB-backed tracked-sender check lives in the webhook.

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  channel: string;
  channel_type?: string; // 'im' | 'channel' | 'group' | 'mpim'
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  event_ts?: string;
  client_msg_id?: string;
}

export interface SlackEventEnvelope {
  type: string; // 'event_callback' | 'url_verification'
  token?: string;
  team_id?: string;
  api_app_id?: string;
  event_id?: string;
  event_time?: number;
  challenge?: string;
  authorizations?: Array<{ team_id?: string; user_id?: string; is_bot?: boolean }>;
  event?: SlackMessageEvent;
}

export type FilterResult =
  | { ok: true; event: SlackMessageEvent & { user: string; text: string }; teamId: string; authedUserId: string | null; channelType: "im" | "channel" }
  | { ok: false; reason: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value.slice(0, 40);
  return typeof value;
}

/** First authorization entry, if the envelope carries a well-formed one. */
function firstAuthorization(envelope: unknown): { team_id?: string; user_id?: string; is_bot?: boolean } | null {
  if (!isRecord(envelope)) return null;
  const list = envelope.authorizations;
  if (!Array.isArray(list) || list.length === 0) return null;
  const first: unknown = list[0];
  if (!isRecord(first)) return null;
  return {
    team_id: optionalString(first.team_id),
    user_id: optionalString(first.user_id),
    is_bot: typeof first.is_bot === "boolean" ? first.is_bot : undefined,
  };
}

/**
 * Accepts only: type='event_callback', event.type='message', no subtype, no bot_id, non-empty text, a user id,
 * and channel_type 'im' (or 'channel'/'group' when opts.allowChannels — bot mode). Everything else → { ok:false, reason }.
 */
export function filterSlackEnvelope(payload: unknown, opts: { allowChannels?: boolean } = {}): FilterResult {
  if (!isRecord(payload)) return { ok: false, reason: "not_an_object" };

  if (payload.type === "url_verification") return { ok: false, reason: "url_verification" };
  if (payload.type !== "event_callback") return { ok: false, reason: `unsupported_type:${describe(payload.type)}` };

  const event = payload.event;
  if (!isRecord(event)) return { ok: false, reason: "missing_event" };
  if (event.type !== "message") return { ok: false, reason: `unsupported_event_type:${describe(event.type)}` };

  // Edits, deletions, joins, file shares, bot posts, … all carry a subtype; the MVP only reels plain human messages.
  if (nonEmptyString(event.subtype)) return { ok: false, reason: `subtype:${event.subtype.slice(0, 40)}` };
  if (nonEmptyString(event.bot_id)) return { ok: false, reason: "bot_message" };

  if (!nonEmptyString(event.user)) return { ok: false, reason: "missing_user" };
  if (typeof event.text !== "string" || event.text.trim().length === 0) return { ok: false, reason: "empty_text" };
  if (!nonEmptyString(event.channel)) return { ok: false, reason: "missing_channel" };
  if (!nonEmptyString(event.ts)) return { ok: false, reason: "missing_ts" };

  const channelTypeRaw = event.channel_type;
  let channelType: "im" | "channel";
  if (channelTypeRaw === "im") {
    channelType = "im";
  } else if ((channelTypeRaw === "channel" || channelTypeRaw === "group") && opts.allowChannels === true) {
    channelType = "channel";
  } else {
    return { ok: false, reason: `channel_type:${describe(channelTypeRaw)}` };
  }

  const authorization = firstAuthorization(payload);
  const teamId = nonEmptyString(payload.team_id) ? payload.team_id : authorization?.team_id;
  if (!nonEmptyString(teamId)) return { ok: false, reason: "missing_team_id" };

  const cleanEvent: SlackMessageEvent & { user: string; text: string } = {
    type: "message",
    channel: event.channel,
    channel_type: channelTypeRaw,
    user: event.user,
    text: event.text,
    ts: event.ts,
    thread_ts: optionalString(event.thread_ts),
    event_ts: optionalString(event.event_ts),
    client_msg_id: optionalString(event.client_msg_id),
  };

  return {
    ok: true,
    event: cleanEvent,
    teamId,
    authedUserId: pickAuthedUserId(payload as unknown as SlackEventEnvelope),
    channelType,
  };
}

/** authorizations[0].user_id when present and not a bot, else null. */
export function pickAuthedUserId(envelope: SlackEventEnvelope): string | null {
  const first = firstAuthorization(envelope);
  if (!first) return null;
  if (first.is_bot === true) return null;
  return nonEmptyString(first.user_id) ? first.user_id : null;
}
