import { pathToFileURL } from "node:url";
import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import rawBody from "fastify-raw-body";
import { config } from "./config.js";
import { registerApiRoutes } from "./routes/api/index.js";
import { registerWebhooks } from "./routes/webhooks/index.js";
import { startTelegramBot } from "./delivery/telegram/bot.js";
import { startWorker } from "./worker/index.js";

export async function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: {
      redact: ["req.headers.authorization", "req.headers['x-demo-secret']", "req.headers.cookie", "res.headers['set-cookie']"],
      serializers: { req: (req) => ({ method: req.method, url: req.url?.split("?")[0], hostname: req.hostname }) },
    },
    bodyLimit: 1024 * 1024,
    ...options,
  });
  app.decorateRequest("userId", "");
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number; code?: string; validation?: unknown };
    const status = err.validation ? 400 : err.statusCode ?? 500;
    if (status >= 500) request.log.error({ code: err.code ?? "INTERNAL", name: err.name }, "Request failed");
    void reply.code(status).send({ error: { code: err.code ?? (status === 400 ? "BAD_REQUEST" : "INTERNAL"), message: status >= 500 ? "Something went wrong. Please try again." : err.message } });
  });
  await app.register(cors, { origin: new URL(config.APP_BASE_URL).origin, allowedHeaders: ["Authorization", "Content-Type"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
  await app.register(rawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });
  app.get("/health", async () => ({ ok: true, service: "reelrelay", engineMode: config.ENGINE_MODE, pipelineMode: config.PIPELINE_MODE }));
  await registerApiRoutes(app);
  await registerWebhooks(app);
  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
  await startWorker(app.log);
  void startTelegramBot().catch(() => app.log.error("Telegram failed to start; check bot configuration."));
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Server failed to start."); process.exitCode = 1; });
}
