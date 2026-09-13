// Dev B. GET /api/integrations/:id/entities → { people }; PUT /api/tracked-entities → { entity }; GET /api/tracked-entities → { entities }.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EntitiesResponse, PutTrackedEntityResponse, TrackableEntity, TrackedEntitiesResponse } from "@reelrelay/shared";
import { requireUser } from "../../auth/requireUser.js";
import { getSlackConnector } from "../../connectors/slack/SlackConnector.js";
import { getConnectionForUser } from "../../db/queries/connections.js";
import { listTrackedEntitiesForUser, replaceTrackedEntity, toApiTrackedEntity } from "../../db/queries/entities.js";
import { ApiError } from "./index.js";

/** Loose 8-4-4-4-12 form: anything else can never be one of the user's connection ids. */
const IdParams = z.object({ id: z.guid() });

const PutTrackedEntityBody = z.object({
  connectionId: z.guid(),
  externalEntityId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  /** "channel" only in bot mode (PLAN.md §10). */
  entityType: z.enum(["person", "channel"]).default("person"),
});

export async function registerEntitiesRoutes(api: FastifyInstance): Promise<void> {
  api.get("/api/integrations/:id/entities", async (req) => {
    const userId = await requireUser(req);
    const params = IdParams.safeParse(req.params);
    if (!params.success) throw new ApiError(404, "not_found", "Integration not found");

    const connection = await getConnectionForUser(params.data.id, userId);
    if (!connection) throw new ApiError(404, "not_found", "Integration not found");
    if (connection.provider !== "slack") {
      throw new ApiError(
        400,
        "unsupported_provider",
        `Trackable entities are only available for Slack connections (this one is '${connection.provider}')`,
      );
    }

    let entities: TrackableEntity[];
    try {
      entities = await getSlackConnector().listTrackableEntities(connection.id);
    } catch (err) {
      req.log.warn({ err, connectionId: connection.id }, "slack listTrackableEntities failed");
      const message = err instanceof Error && err.message ? err.message : "Slack request failed";
      throw new ApiError(502, "slack_error", message);
    }
    return { people: entities.map((entity) => ({ id: entity.id, name: entity.name })) } satisfies EntitiesResponse;
  });

  api.put("/api/tracked-entities", async (req) => {
    const userId = await requireUser(req);
    const body = PutTrackedEntityBody.parse(req.body ?? {});

    const connection = await getConnectionForUser(body.connectionId, userId);
    if (!connection) throw new ApiError(404, "not_found", "Integration not found");

    const row = await replaceTrackedEntity({
      userId,
      connectionId: connection.id,
      entityType: body.entityType,
      externalEntityId: body.externalEntityId,
      displayName: body.displayName,
    });
    return { entity: toApiTrackedEntity(row) } satisfies PutTrackedEntityResponse;
  });

  api.get("/api/tracked-entities", async (req) => {
    const userId = await requireUser(req);
    const rows = await listTrackedEntitiesForUser(userId);
    return { entities: rows.map(toApiTrackedEntity) } satisfies TrackedEntitiesResponse;
  });
}
