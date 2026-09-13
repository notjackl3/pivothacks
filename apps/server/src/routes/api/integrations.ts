// Dev B. GET /api/integrations → IntegrationsResponse; DELETE /api/integrations/:id → { deleted: true } (cascade).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  DeleteIntegrationResponse,
  IntegrationsResponse,
  SlackIntegrationState,
  TelegramIntegrationState,
} from "@reelrelay/shared";
import { requireUser } from "../../auth/requireUser.js";
import { getSlackConnector, type SlackAccountInfo } from "../../connectors/slack/SlackConnector.js";
import {
  deleteConnectionForUser,
  getConnectionForUser,
  getSlackConnectionForUser,
  listConnectionsForUser,
  type ConnectionRow,
} from "../../db/queries/connections.js";
import { ApiError } from "./index.js";

/** Loose 8-4-4-4-12 form: anything else can never be one of the user's connection ids. */
const IdParams = z.object({ id: z.guid() });

function newestOf(rows: ConnectionRow[]): ConnectionRow | null {
  let newest: ConnectionRow | null = null;
  for (const row of rows) {
    if (newest === null || Date.parse(row.created_at) > Date.parse(newest.created_at)) newest = row;
  }
  return newest;
}

async function slackState(userId: string, req: FastifyRequest): Promise<SlackIntegrationState | null> {
  const connection = await getSlackConnectionForUser(userId);
  if (!connection) return null;

  let info: SlackAccountInfo | null = null;
  try {
    info = await getSlackConnector().getAccountInfo(connection.id);
  } catch (err) {
    req.log.warn({ err, connectionId: connection.id }, "slack getAccountInfo failed");
  }

  // getAccountInfo flips connections.status to 'error' on a revoked token; report the fresh status.
  const fresh = (await getConnectionForUser(connection.id, userId)) ?? connection;
  return {
    connected: fresh.status === "active",
    connectionId: fresh.id,
    teamId: fresh.external_account_id,
    teamName: info?.teamName ?? null,
    userName: info?.userName ?? null,
    mode: fresh.mode,
    status: fresh.status,
    scopes: Array.isArray(fresh.scopes) ? fresh.scopes : [],
  };
}

function telegramState(connections: ConnectionRow[]): TelegramIntegrationState | null {
  const connection = newestOf(connections.filter((row) => row.provider === "telegram"));
  if (!connection) return null;
  return {
    connected: connection.status === "active",
    connectionId: connection.id,
    chatId: connection.external_account_id,
  };
}

export async function registerIntegrationsRoutes(api: FastifyInstance): Promise<void> {
  api.get("/api/integrations", async (req) => {
    const userId = await requireUser(req);
    const [slack, connections] = await Promise.all([slackState(userId, req), listConnectionsForUser(userId)]);
    return { slack, telegram: telegramState(connections) } satisfies IntegrationsResponse;
  });

  api.delete("/api/integrations/:id", async (req) => {
    const userId = await requireUser(req);
    const params = IdParams.safeParse(req.params);
    if (!params.success) throw new ApiError(404, "not_found", "Integration not found");
    const deleted = await deleteConnectionForUser(params.data.id, userId);
    if (!deleted) throw new ApiError(404, "not_found", "Integration not found");
    return { deleted: true } satisfies DeleteIntegrationResponse;
  });
}
