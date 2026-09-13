import type { FastifyInstance } from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config, repoRoot } from "../../config.js";
import { getDb } from "../../db/client.js";
import { persistMessage } from "../../db/queries/messages.js";
import { ensureJob } from "../../db/queries/jobs.js";
import { queue } from "../../queue/memoryQueue.js";
import { fixtureNames, MockSourceConnector } from "../../connectors/mock/MockSourceConnector.js";
import { demoClock, setDemoClock, setDemoNowForMessage } from "../../worker/clock.js";

const BodySchema = z.object({ fixture: z.enum(fixtureNames), userId: z.string().uuid(), at: z.string().datetime({ offset: true }).optional() }).strict();
const ClockSchema = z.object({ now: z.string().datetime({ offset: true }).nullable() }).strict();
function requireDemoSecret(headers: Record<string, unknown>): void {
  const secret = config.DEMO_INJECT_SECRET;
  const supplied = headers["x-demo-secret"];
  if (!secret || typeof supplied !== "string" || Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) throw Object.assign(new Error("Demo injection is not authorized."), { statusCode: 401, code: "UNAUTHORIZED" });
}
export async function registerDemoRoutes(app: FastifyInstance): Promise<void> {
  /** Pivot 03 demo clock: `{ now: ISO }` freezes the triage router and the held-job scheduler; `{ now: null }` returns to real time. */
  app.post("/api/demo/clock", async (request) => {
    requireDemoSecret(request.headers as Record<string, unknown>);
    const parsed = ClockSchema.safeParse(request.body);
    if (!parsed.success) throw Object.assign(new Error("Supply { now: ISO-8601 with offset } or { now: null }."), { statusCode: 400, code: "BAD_REQUEST" });
    setDemoClock(parsed.data.now);
    return { now: demoClock()?.toISOString() ?? null, source: parsed.data.now ? "runtime" : config.DEMO_NOW ? "env" : "real" };
  });
  app.get("/api/demo/clock", async (request) => {
    requireDemoSecret(request.headers as Record<string, unknown>);
    return { now: demoClock()?.toISOString() ?? null };
  });
  app.post("/api/demo/inject", async (request) => {
    requireDemoSecret(request.headers as Record<string, unknown>);
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) throw Object.assign(new Error("Supply a known fixture name and a valid userId."), { statusCode: 400, code: "BAD_REQUEST" });
    const { fixture, userId, at } = parsed.data;
    const existingUser = await getDb().from("users").select("id").eq("id", userId).maybeSingle();
    if (existingUser.error) throw existingUser.error;
    if (!existingUser.data) throw Object.assign(new Error("User not found. Complete sign-in first."), { statusCode: 404, code: "NOT_FOUND" });
    const connection = await getDb().from("connections").upsert({ user_id: userId, provider: "mock", external_account_id: "demo-fixtures", status: "active" }, { onConflict: "user_id,provider,external_account_id" }).select("id").single();
    if (connection.error) throw connection.error;
    const [fixtureText, expectedText] = await Promise.all([
      readFile(path.join(repoRoot, "fixtures/slack", `${fixture}.json`), "utf8"),
      readFile(path.join(repoRoot, "fixtures/expected", `${fixture}.json`), "utf8"),
    ]);
    const expected = z.object({ senderDisplayName: z.string() }).parse(JSON.parse(expectedText));
    const normalized = new MockSourceConnector(connection.data.id as string, expected.senderDisplayName).normalizeEvent(JSON.parse(fixtureText));
    if (!normalized) throw new Error("The demo fixture is malformed.");
    normalized.externalMessageId = `demo:${randomUUID()}`;
    const saved = await persistMessage(userId, normalized, true);
    if (at) setDemoNowForMessage(saved.message.id, at);   // Pivot 03: pin the triage clock for this message
    const job = await ensureJob(saved.message.id);
    await queue.add("generate_reel", { messageId: saved.message.id });
    return { messageId: saved.message.id, jobId: job.id, isMock: true };
  });
}
