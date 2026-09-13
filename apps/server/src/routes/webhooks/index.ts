// Dev B. Registers every webhook route inside an encapsulated Fastify scope (the /api error envelope never applies here).
// Raw bodies come from fastify-raw-body, registered once in src/index.ts with global: false; each route opts in via config.
import type { FastifyInstance } from "fastify";
import { registerSlackWebhook } from "./slack.js";
import { registerInstagramWebhook } from "./instagram.js";
import { registerComposioWebhook } from "./composio.js";

export async function registerWebhooks(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    await registerSlackWebhook(scope);
    await registerInstagramWebhook(scope);
    await registerComposioWebhook(scope);
  });
}
