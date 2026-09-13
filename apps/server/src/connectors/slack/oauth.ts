// Dev B. Slack OAuth v2 (PLAN.md §9, §10). User-token flow by default; bot-token flow for the hour-1 fallback.
import { ErrorCode, WebClient, type OauthV2AccessResponse } from "@slack/web-api";
import type { ConnectionMode } from "@reelrelay/shared";
import { config, requireConfig } from "../../config.js";

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const EXCHANGE_TIMEOUT_MS = 15_000;
/** config.ts has no SLACK_BOT_SCOPES key: bot-mode scopes are read from the env var directly, with this default. */
export const DEFAULT_BOT_SCOPES = "channels:history,channels:read,chat:write,users:read";

/** "a, b,,c" → ["a","b","c"]. */
export function parseScopeList(csv: string | undefined | null): string[] {
  if (!csv) return [];
  return csv
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Bot-mode scopes: SLACK_BOT_SCOPES when set and non-empty, else DEFAULT_BOT_SCOPES. */
export function botScopes(): string[] {
  const fromEnv = process.env.SLACK_BOT_SCOPES;
  return parseScopeList(fromEnv && fromEnv.trim().length > 0 ? fromEnv : DEFAULT_BOT_SCOPES);
}

/**
 * https://slack.com/oauth/v2/authorize?client_id&user_scope (or scope in bot mode)&redirect_uri&state
 * Throws requireConfig's { statusCode: 503, code: "CONFIG_MISSING" } error when SLACK_CLIENT_ID is unset.
 */
export function buildAuthorizeUrl(state: string, opts: { mode?: ConnectionMode } = {}): string {
  const mode: ConnectionMode = opts.mode ?? "user_token";
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", requireConfig("SLACK_CLIENT_ID"));
  url.searchParams.set("redirect_uri", config.SLACK_REDIRECT_URI);
  url.searchParams.set("state", state);
  if (mode === "bot_token") {
    url.searchParams.set("scope", botScopes().join(","));
  } else {
    url.searchParams.set("user_scope", parseScopeList(config.SLACK_USER_SCOPES).join(","));
  }
  return url.toString();
}

export interface OAuthExchangeResult {
  teamId: string;
  teamName: string | null;
  authedUserId: string;
  accessToken: string; // xoxp (user_token) or xoxb (bot_token) — plaintext; caller encrypts
  scopes: string[];
  mode: ConnectionMode;
}

function slackErrorOf(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const coded = err as { code?: unknown; data?: { error?: unknown }; message?: unknown };
    if (coded.code === ErrorCode.PlatformError && typeof coded.data?.error === "string") return coded.data.error;
    if (coded.code === ErrorCode.RequestError) return "request_error";
    if (coded.code === ErrorCode.HTTPError) return "http_error";
    if (coded.code === ErrorCode.RateLimitedError) return "rate_limited";
    if (typeof coded.message === "string" && coded.message.length > 0) return coded.message.slice(0, 120);
  }
  return "unknown";
}

function oauthFailure(reason: string): Error {
  return new Error(`slack_oauth_failed:${reason}`);
}

/** Bot installs return a top-level xoxb token; user-only installs return the token under authed_user. */
function detectMode(res: OauthV2AccessResponse): ConnectionMode {
  if (typeof res.access_token === "string" && res.access_token.startsWith("xoxb")) return "bot_token";
  return "user_token";
}

/** oauth.v2.access via @slack/web-api. Throws Error(`slack_oauth_failed:<error>`) on failure. */
export async function exchangeCode(code: string, opts: { mode?: ConnectionMode } = {}): Promise<OAuthExchangeResult> {
  if (typeof code !== "string" || code.length === 0) throw oauthFailure("missing_code");
  // Both are optional in config.ts; an unset pair is a server misconfiguration surfaced as a named failure, never sent as "undefined".
  const clientId = config.SLACK_CLIENT_ID;
  const clientSecret = config.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw oauthFailure("client_not_configured");

  // No token: oauth.v2.access authenticates with client_id/client_secret. No retries: a code is single-use.
  const client = new WebClient(undefined, { timeout: EXCHANGE_TIMEOUT_MS, retryConfig: { retries: 0 } });

  let res: OauthV2AccessResponse;
  try {
    res = await client.oauth.v2.access({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: config.SLACK_REDIRECT_URI,
    });
  } catch (err) {
    throw oauthFailure(slackErrorOf(err));
  }

  if (!res.ok) throw oauthFailure(typeof res.error === "string" && res.error ? res.error : "not_ok");

  const teamId = res.team?.id;
  const teamName = res.team?.name ?? null;
  const authedUserId = res.authed_user?.id;
  if (!teamId) throw oauthFailure("missing_team_id");
  if (!authedUserId) throw oauthFailure("missing_authed_user_id");

  const mode: ConnectionMode = opts.mode ?? detectMode(res);

  if (mode === "bot_token") {
    const accessToken = res.access_token;
    if (!accessToken) throw oauthFailure("missing_bot_access_token");
    return { teamId, teamName, authedUserId, accessToken, scopes: parseScopeList(res.scope), mode };
  }

  const accessToken = res.authed_user?.access_token;
  if (!accessToken) throw oauthFailure("missing_user_access_token");
  return { teamId, teamName, authedUserId, accessToken, scopes: parseScopeList(res.authed_user?.scope), mode };
}
