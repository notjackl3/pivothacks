import type { FastifyInstance } from "fastify";
import { requireUser } from "../../auth/requireUser.js";

export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/messages", { preHandler: async (request) => { await requireUser(request); } }, async () => ({ items: [] }));
}
