// Dev B. POST /webhooks/slack/events — PLAN.md §4.3 sequence (verify → ack → filter → persist → enqueue).
import type { FastifyInstance } from "fastify";
import type { NormalizedMessage } from "@reelrelay/shared";
import { config } from "../../config.js";
import { filterSlackEnvelope } from "../../connectors/slack/filter.js";
import { normalizeSlackEvent } from "../../connectors/slack/normalize.js";
import { verifySlackHeaders } from "../../connectors/slack/verify.js";
import { findSlackConnectionForEvent, type ConnectionRow } from "../../db/queries/connections.js";
import { findTrackedEntity, type TrackedEntityRow } from "../../db/queries/entities.js";
import { ensureJob, type JobRow } from "../../db/queries/jobs.js";
import { persistMessage, type MessageRow } from "../../db/queries/messages.js";
import { queue } from "../../queue/memoryQueue.js";

const EVENTS_PATH = "/webhooks/slack/events";
const LOG_BODY_MAX = 80;

export interface WebhookLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Dependencies of processSlackEnvelope; every field has a real default. Tests pass fakes. */
export interface ProcessDeps {
  findConnection: (teamId: string, authedUserId: string | null) => Promise<ConnectionRow | null>;
  findTracked: (connectionId: string, entityType: "person" | "channel", externalEntityId: string) => Promise<TrackedEntityRow | null>;
  /**
   * Dev A's persistMessage: idempotent upsert on (connection_id, external_message_id); on duplicate delivery resolves
   * with the EXISTING row and inserted=false. Throws { statusCode: 404, code: "NOT_FOUND" } unless the connection is
   * 'active' with a matching provider.
   */
  persistMessage: (userId: string, normalized: NormalizedMessage) => Promise<{ message: Pick<MessageRow, "id">; inserted: boolean }>;
  /** Dev A's ensureJob: creates the queued processing job (idempotent on message_id) or returns the existing one. */
  ensureJob: (messageId: string) => Promise<Pick<JobRow, "status">>;
  /** queue.add("generate_reel", { messageId }); the queue coalesces duplicates by messageId. */
  enqueue: (messageId: string) => Promise<void>;
  log: WebhookLogger;
}

export interface SlackWebhookDeps {
  // Injected for tests; defaults wire the real modules.
  verify?: (rawBody: string, headers: Record<string, string | string[] | undefined>) => boolean;
  process?: (payload: unknown) => Promise<{ outcome: string; messageId?: string }>;
}

export type ProcessOutcome = { outcome: string; messageId?: string };

const consoleLogger: WebhookLogger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** persistMessage's "connection not active / wrong provider" error. */
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { statusCode, code } = err as { statusCode?: unknown; code?: unknown };
  return statusCode === 404 || code === "NOT_FOUND";
}

/** Never log more than 80 chars of a body (PLAN.md §16). */
function truncate(value: unknown, max = LOG_BODY_MAX): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** fastify-raw-body sets request.rawBody as a utf8 string (encoding: "utf8"); tolerate a Buffer and a missing value. */
function rawBodyOf(value: string | Buffer | undefined): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

// ───────────────────────────── default deps (real DB + queue) ─────────────────────────────

const defaultDeps: ProcessDeps = {
  findConnection: findSlackConnectionForEvent,
  findTracked: findTrackedEntity,
  persistMessage: (userId, normalized) => persistMessage(userId, normalized),
  ensureJob,
  enqueue: (messageId) => queue.add("generate_reel", { messageId }),
  log: consoleLogger,
};

/**
 * Steps 4–8 for one already-verified envelope. Exported so tests can call it with fakes. Never throws (logs instead).
 * Outcomes: 'ignored:<reason>' | 'no_connection' | 'untracked' | 'duplicate' | 'queued' | 'error:<msg>'.
 */
export async function processSlackEnvelope(payload: unknown, deps: Partial<ProcessDeps> = {}): Promise<ProcessOutcome> {
  const d: ProcessDeps = { ...defaultDeps, ...deps };
  try {
    // Step 4: structural filter. Channels pass here; the connection's mode decides below.
    const filtered = filterSlackEnvelope(payload, { allowChannels: true });
    if (!filtered.ok) return { outcome: `ignored:${filtered.reason}` };
    const { event, teamId, authedUserId, channelType } = filtered;

    // Step 5: which student's connection does this event belong to?
    const connection = await d.findConnection(teamId, authedUserId);
    if (!connection) return { outcome: "no_connection" };

    const botMode = connection.mode === "bot_token";
    // User-token mode only reels DMs (PLAN.md §4.3 step 4); channel events are accepted for bot-mode connections (§10).
    if (!botMode && channelType !== "im") return { outcome: `ignored:channel_type:${event.channel_type ?? "unknown"}` };
    // Bot mode tracks a whole channel; never reel the student's own posts in it.
    if (botMode && connection.external_user_id && event.user === connection.external_user_id) return { outcome: "ignored:self" };

    // Step 6: only the single tracked sender (user mode) / tracked channel (bot mode) is persisted.
    const entityType: "person" | "channel" = botMode ? "channel" : "person";
    const externalEntityId = botMode ? event.channel : event.user;
    const tracked = await d.findTracked(connection.id, entityType, externalEntityId);
    if (!tracked || tracked.enabled === false) return { outcome: "untracked" };

    const normalized = normalizeSlackEvent(payload, { connectionId: connection.id, senderDisplayName: tracked.display_name });
    if (!normalized) return { outcome: "ignored:unnormalizable" };

    // Step 7: idempotent insert. persistMessage requires an ACTIVE connection: a flagged ('error') one is no connection.
    let persisted: { message: Pick<MessageRow, "id">; inserted: boolean };
    try {
      persisted = await d.persistMessage(connection.user_id, normalized);
    } catch (err) {
      if (isNotFound(err)) return { outcome: "no_connection" };
      throw err;
    }
    const messageId = persisted.message.id;

    // Step 8: job row + queue. A missing or still-queued job is repaired even on duplicate delivery (Slack retries,
    // a crash between insert and enqueue); a job that already ran is never re-run.
    const job = await d.ensureJob(messageId);
    if (persisted.inserted || job.status === "queued") await d.enqueue(messageId);

    if (!persisted.inserted) {
      d.log.info(`[slack] duplicate delivery of ${normalized.externalMessageId} → message ${messageId} (job ${job.status})`);
      return { outcome: "duplicate", messageId };
    }
    d.log.info(`[slack] queued message ${messageId} (${normalized.externalMessageId})`);
    return { outcome: "queued", messageId };
  } catch (err) {
    d.log.error(`[slack] processSlackEnvelope failed: ${messageOf(err)} body=${truncate(payload)}`);
    return { outcome: `error:${messageOf(err).slice(0, 120)}` };
  }
}

/** Registers the route on the given (encapsulated) scope. */
export async function registerSlackWebhook(scope: FastifyInstance, deps: SlackWebhookDeps = {}): Promise<void> {
  const log: WebhookLogger = {
    info: (msg) => scope.log.info(msg),
    warn: (msg) => scope.log.warn(msg),
    error: (msg) => scope.log.error(msg),
  };
  const verify =
    deps.verify ??
    ((rawBody, headers) => {
      // SLACK_SIGNING_SECRET is optional in config.ts; without it nothing can be verified, so everything is rejected.
      const signingSecret = config.SLACK_SIGNING_SECRET;
      if (!signingSecret) {
        log.error("[slack] SLACK_SIGNING_SECRET is not configured; rejecting the delivery");
        return false;
      }
      return verifySlackHeaders(rawBody, headers, signingSecret);
    });
  const handle = deps.process ?? ((payload: unknown) => processSlackEnvelope(payload, { log }));

  // { rawBody: true } opts this route into fastify-raw-body (registered in src/index.ts with global: false, runFirst: true):
  // the signature is an HMAC over the exact bytes Slack sent, so re-serialised JSON would never match.
  // Malformed JSON is rejected by Fastify's own parser (400) before this handler runs.
  scope.post(EVENTS_PATH, { config: { rawBody: true } }, async (req, reply) => {
    const rawBody = rawBodyOf(req.rawBody);

    // Step 1: signature + timestamp on the raw body, before anything else (even url_verification) touches the parsed body.
    if (!verify(rawBody, req.headers)) {
      log.warn(`[slack] rejected request with invalid signature body=${truncate(rawBody)}`);
      return reply.code(401).send({ error: { code: "invalid_signature", message: "Slack signature verification failed" } });
    }

    const retryNum = req.headers["x-slack-retry-num"];
    if (retryNum !== undefined) {
      const reason = req.headers["x-slack-retry-reason"];
      log.info(`[slack] retry delivery num=${String(retryNum)} reason=${String(reason ?? "unknown")}`);
    }

    const payload: unknown = req.body;

    // Step 2: URL verification handshake.
    if (isRecord(payload) && payload.type === "url_verification") {
      const challenge = typeof payload.challenge === "string" ? payload.challenge : "";
      return reply.code(200).send({ challenge });
    }

    // Step 3: ack within 3 s; all real work happens after the response is on the wire.
    setImmediate(() => {
      handle(payload)
        .then((result) => {
          if (result.outcome !== "queued") log.info(`[slack] event outcome=${result.outcome}`);
        })
        .catch((err: unknown) => {
          log.error(`[slack] unhandled processing failure: ${messageOf(err)} body=${truncate(payload)}`);
        });
    });

    return reply.code(200).send({});
  });
}
