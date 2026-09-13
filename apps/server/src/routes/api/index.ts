import type { FastifyInstance } from "fastify";
import { registerMessageRoutes } from "./messages.js";
import { registerDemoRoutes } from "./demo.js";

// Dev B owns this registration point after the skeleton handoff.
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await registerMessageRoutes(app);
  await registerDemoRoutes(app);
}
