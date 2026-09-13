import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ComposioConnectResponse, ComposioRefreshResponse, ComposioSourcesResponse } from "@reelrelay/shared";
import { requireUser } from "../../auth/requireUser.js";
import { config, requireConfig } from "../../config.js";
import { ComposioToolkitSchema, composioAuthConfigs, composioTriggerSlugs, configuredComposioToolkits } from "../../connectors/composio/config.js";
import { createConnectLink, ensureInboundTrigger, getConnectedAccount } from "../../connectors/composio/client.js";
import { getComposioSourceForUser, listComposioSources, toComposioSourceState, updateComposioSource, upsertComposioSource, type ComposioSourceRow } from "../../db/queries/composio.js";
import { ApiError } from "./index.js";

const ConnectBody = z.object({ toolkit: ComposioToolkitSchema });
const IdParams = z.object({ id: z.guid() });

async function reconcile(source: ComposioSourceRow): Promise<ComposioSourceRow> {
  try {
    const account = await getConnectedAccount(source.connected_account_id);
    const status = account.status.toUpperCase();
    if (status === "ACTIVE") {
      const triggerId = source.trigger_id ?? await ensureInboundTrigger(source.toolkit, source.connected_account_id);
      if (source.status !== "active" || source.trigger_id !== triggerId) return updateComposioSource(source.id, { status: "active", trigger_id: triggerId, error_detail: null });
      return source;
    }
    if (["EXPIRED", "REVOKED", "DISABLED"].includes(status)) return updateComposioSource(source.id, { status: "expired", error_detail: "Provider authorization expired. Reconnect this source." });
    if (["FAILED", "ERROR"].includes(status)) return updateComposioSource(source.id, { status: "error", error_detail: `Composio connection status: ${status}` });
    return source;
  } catch (error) {
    return updateComposioSource(source.id, { status: "error", error_detail: error instanceof Error ? error.message : "Could not verify the connection." });
  }
}

export async function registerComposioRoutes(api: FastifyInstance): Promise<void> {
  api.get("/api/composio/sources", async (req) => {
    const userId = await requireUser(req);
    if (!config.COMPOSIO_API_KEY) return { configuredToolkits: [], sources: [] } satisfies ComposioSourcesResponse;
    const sources = await listComposioSources(userId);
    const refreshed = await Promise.all(sources.map(reconcile));
    return { configuredToolkits: configuredComposioToolkits(), sources: refreshed.map(toComposioSourceState) } satisfies ComposioSourcesResponse;
  });

  api.post("/api/composio/connect", async (req) => {
    const userId = await requireUser(req);
    requireConfig("COMPOSIO_API_KEY");
    const { toolkit } = ConnectBody.parse(req.body);
    const authConfigId = composioAuthConfigs()[toolkit];
    const triggerSlug = composioTriggerSlugs()[toolkit];
    if (!authConfigId || !triggerSlug) throw new ApiError(503, "source_not_configured", `${toolkit} has not been configured by the ReelRelay administrator.`);
    const callbackUrl = `${config.APP_BASE_URL}/setup?composio=return&toolkit=${encodeURIComponent(toolkit)}`;
    const link = await createConnectLink(userId, toolkit, callbackUrl);
    const source = await upsertComposioSource({ userId, toolkit, authConfigId, triggerSlug, connectedAccountId: link.connectedAccountId });
    return { source: toComposioSourceState(source), redirectUrl: link.redirectUrl, expiresAt: link.expiresAt } satisfies ComposioConnectResponse;
  });

  api.post("/api/composio/sources/:id/refresh", async (req) => {
    const userId = await requireUser(req);
    const params = IdParams.safeParse(req.params);
    if (!params.success) throw new ApiError(404, "not_found", "Source connection not found");
    const source = await getComposioSourceForUser(params.data.id, userId);
    if (!source) throw new ApiError(404, "not_found", "Source connection not found");
    return { source: toComposioSourceState(await reconcile(source)) } satisfies ComposioRefreshResponse;
  });
}
