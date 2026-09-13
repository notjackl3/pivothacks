// Dev B. GET /api/integrations/slack/start (bearer) → { url }; GET /api/integrations/slack/callback (no bearer) → 302 /setup?slack=ok
import type { FastifyInstance } from "fastify";
import type { ConnectionMode, SlackStartResponse } from "@reelrelay/shared";
import { requireUser } from "../../auth/requireUser.js";
import { config } from "../../config.js";
import { buildAuthorizeUrl, exchangeCode, type OAuthExchangeResult } from "../../connectors/slack/oauth.js";
import { getSlackConnector } from "../../connectors/slack/SlackConnector.js";
import { upsertSlackConnection } from "../../db/queries/connections.js";
import { encrypt } from "../../security/crypto.js";
import { createOAuthState, verifyOAuthState, type OAuthState } from "../../security/oauthState.js";
import { ApiError } from "./index.js";

const SETUP_PATH = "/setup";
const MAX_REASON_LENGTH = 200;

interface StartQuery {
  mode?: string;
}

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

function setupRedirect(outcome: "ok"): string;
function setupRedirect(outcome: "error", reason: string): string;
function setupRedirect(outcome: "ok" | "error", reason?: string): string {
  const url = new URL(SETUP_PATH, config.APP_BASE_URL);
  url.searchParams.set("slack", outcome);
  if (outcome === "error") url.searchParams.set("reason", (reason ?? "unknown").slice(0, MAX_REASON_LENGTH));
  return url.toString();
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** requireConfig's error (OAUTH_STATE_SECRET unset): a server misconfiguration, not a bad state from the client. */
function isConfigMissing(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "CONFIG_MISSING";
}

export async function registerSlackRoutes(api: FastifyInstance): Promise<void> {
  // Browser calls this with a bearer, receives the authorize URL, then navigates to it. Identity travels in the signed state.
  // createOAuthState / buildAuthorizeUrl throw 503 CONFIG_MISSING when OAUTH_STATE_SECRET / SLACK_CLIENT_ID are unset.
  api.get<{ Querystring: StartQuery }>("/api/integrations/slack/start", async (req): Promise<SlackStartResponse> => {
    const userId = await requireUser(req);
    const mode: ConnectionMode = firstString(req.query.mode) === "bot_token" ? "bot_token" : "user_token";
    return { url: buildAuthorizeUrl(createOAuthState(userId), { mode }) };
  });

  // NO bearer: Slack redirects the browser here. The signed state is the only proof of who started the flow.
  api.get<{ Querystring: CallbackQuery }>("/api/integrations/slack/callback", async (req, reply) => {
    const slackError = firstString(req.query.error);
    if (slackError) {
      req.log.warn({ slackError }, "[slack] oauth denied by slack");
      return reply.redirect(setupRedirect("error", slackError), 302);
    }

    // verifyOAuthState throws on a missing/malformed/tampered/expired state (no null return).
    const state = firstString(req.query.state);
    let verified: OAuthState;
    try {
      verified = verifyOAuthState(state ?? "");
    } catch (err) {
      if (isConfigMissing(err)) throw err;
      req.log.warn({ reason: messageOf(err) }, "[slack] oauth state rejected");
      throw new ApiError(400, "invalid_state", "OAuth state is missing, tampered, or expired");
    }

    const code = firstString(req.query.code);
    if (!code) return reply.redirect(setupRedirect("error", "missing_code"), 302);

    let exchanged: OAuthExchangeResult;
    try {
      exchanged = await exchangeCode(code); // mode is detected from Slack's response
    } catch (err) {
      req.log.warn({ reason: messageOf(err) }, "[slack] oauth code exchange failed");
      return reply.redirect(setupRedirect("error", messageOf(err)), 302);
    }

    let connectionId: string;
    try {
      const connection = await upsertSlackConnection({
        userId: verified.userId,
        teamId: exchanged.teamId,
        authedUserId: exchanged.authedUserId,
        encryptedAccessToken: encrypt(exchanged.accessToken),
        scopes: exchanged.scopes,
        mode: exchanged.mode,
      });
      connectionId = connection.id;
    } catch (err) {
      req.log.error({ reason: messageOf(err) }, "[slack] could not store connection");
      return reply.redirect(setupRedirect("error", "connection_store_failed"), 302);
    }

    getSlackConnector().invalidateAccountInfo(connectionId);
    req.log.info({ connectionId, teamId: exchanged.teamId, mode: exchanged.mode }, "[slack] connected");
    return reply.redirect(setupRedirect("ok"), 302);
  });
}
