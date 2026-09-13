// Dev B. Registers every /api route (B's and A's) inside one encapsulated scope with the { error: { code, message } } envelope.
import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { registerIntegrationsRoutes } from "./integrations.js";
import { registerSlackRoutes } from "./slack.js";
import { registerEntitiesRoutes } from "./entities.js";
import { registerTelegramRoutes } from "./telegram.js";
import { registerRepliesRoutes } from "./replies.js";
import { registerPreferencesRoutes } from "./preferences.js";
import { registerMessageRoutes } from "./messages.js"; // A-owned
import { registerDemoRoutes } from "./demo.js"; // A-owned

/** Throwable API error; the scoped error handler turns it into { error: { code, message } } with the status. */
export class ApiError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function sendApiError(reply: FastifyReply, statusCode: number, code: string, message: string): FastifyReply {
  return reply.code(statusCode).send({ error: { code, message } });
}

interface ResolvedError {
  statusCode: number;
  code: string;
  message: string;
}

/** Duck-typed so a ZodError from a second zod copy (workspace hoisting) is still recognised. */
function isZodError(err: unknown): err is ZodError {
  if (err instanceof ZodError) return true;
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "ZodError";
}

function formatZodError(err: ZodError): string {
  const issues = Array.isArray(err.issues) ? err.issues : [];
  const parts = issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return parts.length > 0 ? parts.join("; ") : "Invalid request";
}

/**
 * Safe property reads for thrown values of unknown shape. Dev A's modules throw plain Errors decorated with
 * Object.assign(new Error(msg), { statusCode, code }) — requireUser (401 UNAUTHORIZED), requireConfig (503 CONFIG_MISSING),
 * persistMessage (404 NOT_FOUND) — and the query files throw { statusCode: 500, code: "db_error" }; Fastify's own errors
 * (malformed JSON, unsupported media type, payload too large, …) carry statusCode + an FST_ERR_* code.
 */
function httpStatusOf(err: object): number | null {
  const status = (err as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
}

function codeOf(err: object): string | null {
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

function messageOf(err: object): string {
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function resolveError(err: unknown): ResolvedError | null {
  if (isZodError(err)) return { statusCode: 400, code: "bad_request", message: formatZodError(err) };
  if (err instanceof ApiError) return { statusCode: err.statusCode, code: err.code, message: err.message || err.code };
  if (typeof err !== "object" || err === null) return null;

  // Fastify JSON-schema validation failure.
  if ((err as { validation?: unknown }).validation !== undefined) {
    return { statusCode: 400, code: "bad_request", message: messageOf(err) || "Invalid request" };
  }

  // Anything else carrying a numeric HTTP status is an HTTP error, whatever module threw it.
  const statusCode = httpStatusOf(err);
  if (statusCode === null) return null;
  const rawCode = codeOf(err);
  const code =
    rawCode === null || (rawCode.startsWith("FST_ERR_") && statusCode === 400)
      ? statusCode >= 500
        ? "internal"
        : "bad_request"
      : rawCode;
  // A 5xx raised outside a route (db_error with SQL text, CONFIG_MISSING naming an env key, …) may describe internals:
  // keep the code for the client, log the message below, and send a generic message. Route-authored ApiErrors are returned as written.
  const message = statusCode >= 500 ? "Internal server error" : messageOf(err) || code;
  return { statusCode, code, message };
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  // Encapsulated scope: the error and not-found handlers below never leak into the webhook routes' contexts.
  await app.register(async (api) => {
    api.setErrorHandler((err: Error, req, reply) => {
      const resolved = resolveError(err);
      if (resolved === null) {
        req.log.error({ err, method: req.method, url: req.url }, "unhandled api error");
        return sendApiError(reply, 500, "internal", "Internal server error");
      }
      if (resolved.statusCode >= 500) {
        req.log.error({ err, method: req.method, url: req.url }, `api error ${resolved.code}`);
      }
      return sendApiError(reply, resolved.statusCode, resolved.code, resolved.message);
    });

    api.setNotFoundHandler((_req, reply) => sendApiError(reply, 404, "not_found", "Route not found"));

    await registerIntegrationsRoutes(api);
    await registerSlackRoutes(api);
    await registerEntitiesRoutes(api);
    await registerTelegramRoutes(api);
    await registerRepliesRoutes(api);
    await registerPreferencesRoutes(api);
    await registerMessageRoutes(api);
    await registerDemoRoutes(api);
  });
}
