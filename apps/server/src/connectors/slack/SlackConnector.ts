// Dev B. SourceConnector implementation for Slack (PLAN.md §4.2, §10, §15).
import { ErrorCode, WebClient, type WebAPIPlatformError } from "@slack/web-api";
import type { NormalizedMessage, SourceConnector, TrackableEntity } from "@reelrelay/shared";
import { config } from "../../config.js";
import { decrypt } from "../../security/crypto.js";
import { createOAuthState } from "../../security/oauthState.js";
import { getConnectionById, setConnectionStatus, type ConnectionRow } from "../../db/queries/connections.js";
import { getUserProfile, studentNameFor } from "../../db/queries/preferences.js";
import { buildAuthorizeUrl } from "./oauth.js";
import { filterSlackEnvelope } from "./filter.js";
import { normalizeSlackEvent, parentTs } from "./normalize.js";
import { verifySlackHeaders } from "./verify.js";

/** Thrown by sendReply. kind='api_error' → Slack answered with an error (draft → failed).
 *  kind='network' → request may have left but no response (draft → send_uncertain). */
export class SlackSendError extends Error {
  kind: "api_error" | "network";
  slackError: string | null;
  constructor(kind: "api_error" | "network", message: string, slackError: string | null = null) {
    super(message);
    this.name = "SlackSendError";
    this.kind = kind;
    this.slackError = slackError;
  }
}

export interface SlackAccountInfo {
  teamName: string | null;
  userName: string | null;
}

/** Slack errors that mean the stored token is dead (PLAN.md §15 "Token revoked"). */
const TOKEN_REVOKED_ERRORS: ReadonlySet<string> = new Set([
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "not_authed",
  "token_expired",
]);

const ACCOUNT_INFO_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const USERS_LIST_PAGE = 200;
const REPLIES_LOOKBACK_SEC = 5;
const REPLIES_LIMIT = 100;
const BOT_PREFIX = "On behalf of";

/**
 * retries MUST stay 0: a retried chat.postMessage can double-post a reply after a lost response.
 * rejectRateLimitedCalls: a 429 is a definitive "not posted", so surface it instead of sleeping and retrying.
 */
function clientFor(token: string): WebClient {
  return new WebClient(token, { timeout: REQUEST_TIMEOUT_MS, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
}

function isPlatformError(err: unknown): err is WebAPIPlatformError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === ErrorCode.PlatformError &&
    typeof (err as { data?: { error?: unknown } }).data?.error === "string"
  );
}

function errorCodeOf(err: unknown): string | null {
  if (typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Slack HTML-escapes &, <, > in stored message text; compare on the unescaped form. */
function canonicalText(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
}

export class SlackConnector implements SourceConnector {
  private accountInfoCache = new Map<string, { expiresAt: number; value: SlackAccountInfo }>();

  /** { authorizeUrl } with a signed state for userId (createOAuthState). Throws 503 CONFIG_MISSING when OAUTH_STATE_SECRET or SLACK_CLIENT_ID is unset. */
  async connect(userId: string): Promise<{ authorizeUrl: string }> {
    return { authorizeUrl: buildAuthorizeUrl(createOAuthState(userId)) };
  }

  /** users.list, humans only (no deleted, no bots, not USLACKBOT), name = real_name || profile.display_name || name. */
  async listTrackableEntities(connectionId: string): Promise<TrackableEntity[]> {
    const connection = await this.requireConnection(connectionId);
    const client = clientFor(this.tokenFor(connection));
    const people: TrackableEntity[] = [];
    let cursor: string | undefined;

    try {
      do {
        const res = await client.users.list({ limit: USERS_LIST_PAGE, cursor });
        for (const member of res.members ?? []) {
          if (!member.id || member.id === "USLACKBOT") continue;
          if (member.deleted || member.is_bot || member.is_app_user) continue;
          const name = member.real_name || member.profile?.display_name || member.profile?.real_name || member.name || member.id;
          people.push({ id: member.id, name, entityType: "person" });
        }
        const next = res.response_metadata?.next_cursor;
        cursor = typeof next === "string" && next.length > 0 ? next : undefined;
      } while (cursor);
    } catch (err) {
      await this.flagIfRevoked(connection.id, err);
      throw err;
    }

    people.sort((a, b) => a.name.localeCompare(b.name));
    return people;
  }

  /** Bot mode helper: channels the token can see, for the tracked-channel picker (conversations.list). */
  async listTrackableChannels(connectionId: string): Promise<TrackableEntity[]> {
    const connection = await this.requireConnection(connectionId);
    const client = clientFor(this.tokenFor(connection));
    const channels: TrackableEntity[] = [];
    let cursor: string | undefined;

    try {
      do {
        const res = await client.conversations.list({
          limit: USERS_LIST_PAGE,
          cursor,
          exclude_archived: true,
          types: "public_channel,private_channel",
        });
        for (const channel of res.channels ?? []) {
          if (!channel.id) continue;
          channels.push({ id: channel.id, name: channel.name ? `#${channel.name}` : channel.id, entityType: "channel" });
        }
        const next = res.response_metadata?.next_cursor;
        cursor = typeof next === "string" && next.length > 0 ? next : undefined;
      } while (cursor);
    } catch (err) {
      await this.flagIfRevoked(connection.id, err);
      throw err;
    }

    channels.sort((a, b) => a.name.localeCompare(b.name));
    return channels;
  }

  /** false when SLACK_SIGNING_SECRET is unset: a missing secret must never turn into an HMAC over "undefined". */
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean {
    const signingSecret = config.SLACK_SIGNING_SECRET;
    if (!signingSecret) return false;
    return verifySlackHeaders(rawBody, headers, signingSecret);
  }

  /** Without connection context: connectionId is "" and senderDisplayName is the raw user id. The webhook uses normalizeSlackEvent with ctx instead. */
  normalizeEvent(payload: unknown): NormalizedMessage | null {
    const filtered = filterSlackEnvelope(payload, { allowChannels: true });
    if (!filtered.ok) return null;
    return normalizeSlackEvent(payload, { connectionId: "", senderDisplayName: filtered.event.user });
  }

  /**
   * chat.postMessage with the connection's token, channel = message.externalChannelId, thread_ts = parentTs(...).
   * Bot mode: text is prefixed `On behalf of <student name>:`. Token revoked/invalid → connections.status='error' then throw.
   * Only the approve/retry path may call this (PLAN.md §13 acceptance for task 13).
   */
  async sendReply(message: NormalizedMessage, text: string): Promise<{ externalMessageId: string }> {
    // Everything before the request is issued is a definite failure (nothing left the process) → api_error.
    let connection: ConnectionRow;
    let client: WebClient;
    let body: string;
    try {
      connection = await this.requireConnection(message.connectionId);
      client = clientFor(this.tokenFor(connection));
      body = await this.outgoingText(connection, text);
    } catch (err) {
      if (err instanceof SlackSendError) throw err;
      throw new SlackSendError("api_error", `Could not prepare Slack reply: ${messageOf(err)}`, null);
    }

    try {
      const res = await client.chat.postMessage({
        channel: message.externalChannelId,
        text: body,
        thread_ts: parentTs(message.externalMessageId, message.externalThreadId),
      });
      if (!res.ok || typeof res.ts !== "string" || res.ts.length === 0) {
        throw new SlackSendError("api_error", "Slack did not return a message ts", typeof res.error === "string" ? res.error : null);
      }
      return { externalMessageId: res.ts };
    } catch (err) {
      throw await this.classifySendError(connection.id, err);
    }
  }

  /** PLAN.md §15: conversations.replies(channel, thread_ts, oldest=approvedAt) → a message from the connection's user with identical text. */
  async reconcileUncertainSend(
    message: NormalizedMessage,
    text: string,
    approvedAtIso: string,
  ): Promise<{ found: true; externalMessageId: string } | { found: false }> {
    let connection: ConnectionRow;
    let client: WebClient;
    let expected: string;
    try {
      connection = await this.requireConnection(message.connectionId);
      client = clientFor(this.tokenFor(connection));
      expected = canonicalText(await this.outgoingText(connection, text));
    } catch {
      return { found: false };
    }

    const approvedMs = Date.parse(approvedAtIso);
    const approvedSec = Number.isFinite(approvedMs) ? Math.floor(approvedMs / 1000) : 0;
    const oldest = String(Math.max(0, approvedSec - REPLIES_LOOKBACK_SEC));
    const thread = parentTs(message.externalMessageId, message.externalThreadId);
    const botMode = connection.mode === "bot_token";

    try {
      const res = await client.conversations.replies({
        channel: message.externalChannelId,
        ts: thread,
        oldest,
        limit: REPLIES_LIMIT,
      });
      const match = (res.messages ?? []).find((m) => {
        if (typeof m.ts !== "string" || m.ts === thread) return false;
        if (typeof m.text !== "string" || canonicalText(m.text) !== expected) return false;
        return botMode ? Boolean(m.bot_id) : m.user === connection.external_user_id;
      });
      if (match && typeof match.ts === "string") return { found: true, externalMessageId: match.ts };
      return { found: false };
    } catch (err) {
      await this.flagIfRevoked(connection.id, err);
      return { found: false };
    }
  }

  /** auth.test with the connection's token; cached 60 s per connection. invalid_auth/token_revoked/account_inactive → status='error', returns null. */
  async getAccountInfo(connectionId: string): Promise<SlackAccountInfo | null> {
    const cached = this.accountInfoCache.get(connectionId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const connection = await getConnectionById(connectionId);
    if (!connection || !connection.encrypted_access_token) return null;

    let client: WebClient;
    try {
      client = clientFor(this.tokenFor(connection));
    } catch {
      return null;
    }

    try {
      const res = await client.auth.test();
      const value: SlackAccountInfo = {
        teamName: typeof res.team === "string" && res.team ? res.team : null,
        userName: typeof res.user === "string" && res.user ? res.user : null,
      };
      this.accountInfoCache.set(connectionId, { expiresAt: Date.now() + ACCOUNT_INFO_TTL_MS, value });
      return value;
    } catch (err) {
      // Revoked → flag the connection; any other failure leaves the status alone (transient).
      await this.flagIfRevoked(connectionId, err);
      return null;
    }
  }

  /** Drop the cached auth.test result (call after a reconnect so Setup reflects the new token immediately). */
  invalidateAccountInfo(connectionId: string): void {
    this.accountInfoCache.delete(connectionId);
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async requireConnection(connectionId: string): Promise<ConnectionRow> {
    const connection = await getConnectionById(connectionId);
    if (!connection) throw new SlackSendError("api_error", `Slack connection ${connectionId} not found`, "connection_not_found");
    if (connection.provider !== "slack") throw new SlackSendError("api_error", `Connection ${connectionId} is not a Slack connection`, "wrong_provider");
    if (!connection.encrypted_access_token) throw new SlackSendError("api_error", `Slack connection ${connectionId} has no token`, "no_token");
    return connection;
  }

  /** Dev A's decrypt(ciphertext, key = requireConfig("TOKEN_ENCRYPTION_KEY")): an unset key surfaces as a clear CONFIG_MISSING message. */
  private tokenFor(connection: ConnectionRow): string {
    const ciphertext = connection.encrypted_access_token;
    if (!ciphertext) throw new SlackSendError("api_error", `Slack connection ${connection.id} has no token`, "no_token");
    try {
      return decrypt(ciphertext);
    } catch (err) {
      const slackError = errorCodeOf(err) === "CONFIG_MISSING" ? "token_key_not_configured" : "token_undecryptable";
      throw new SlackSendError("api_error", `Could not decrypt the Slack token: ${messageOf(err)}`, slackError);
    }
  }

  /** Bot mode prefixes the student's name because the message is posted by the bot, not the student (PLAN.md §10). */
  private async outgoingText(connection: ConnectionRow, text: string): Promise<string> {
    if (connection.mode !== "bot_token") return text;
    const profile = await getUserProfile(connection.user_id);
    return `${BOT_PREFIX} ${studentNameFor(profile)}: ${text}`;
  }

  private async flagIfRevoked(connectionId: string, err: unknown): Promise<boolean> {
    if (!isPlatformError(err) || !TOKEN_REVOKED_ERRORS.has(err.data.error)) return false;
    try {
      await setConnectionStatus(connectionId, "error");
    } catch (statusErr) {
      console.error(`[slack] could not flag connection ${connectionId} as error: ${messageOf(statusErr)}`);
    }
    this.accountInfoCache.delete(connectionId);
    return true;
  }

  /**
   * Slack answered → api_error (the reply was NOT posted).
   * No usable answer (socket/timeout/HTTP failure) → network (the reply MAY have been posted → send_uncertain).
   */
  private async classifySendError(connectionId: string, err: unknown): Promise<SlackSendError> {
    if (err instanceof SlackSendError) return err;

    if (isPlatformError(err)) {
      const slackError = err.data.error;
      await this.flagIfRevoked(connectionId, err);
      return new SlackSendError("api_error", `Slack rejected the reply: ${slackError}`, slackError);
    }

    const code = errorCodeOf(err);
    if (code === ErrorCode.RateLimitedError) {
      return new SlackSendError("api_error", "Slack rate-limited the reply", "rate_limited");
    }
    if (code === ErrorCode.HTTPError) {
      const status = (err as { statusCode?: number }).statusCode;
      return new SlackSendError("network", `Slack returned HTTP ${status ?? "error"} without a result`, null);
    }
    if (code === ErrorCode.RequestError) {
      return new SlackSendError("network", `Slack request failed: ${messageOf(err)}`, null);
    }
    // Unknown failure after the request was issued: treat as uncertain so the reconcile path can check.
    return new SlackSendError("network", `Slack request failed: ${messageOf(err)}`, null);
  }
}

let instance: SlackConnector | null = null;
export function getSlackConnector(): SlackConnector {
  if (!instance) instance = new SlackConnector();
  return instance;
}
