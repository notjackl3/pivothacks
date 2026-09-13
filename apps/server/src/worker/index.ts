import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { queue } from "../queue/memoryQueue.js";
import { recoverJobs } from "../db/queries/jobs.js";
import { generateReel } from "./generateReel.js";

let started = false;
export async function startWorker(logger?: FastifyBaseLogger): Promise<void> {
  if (started) return;
  started = true;
  queue.process("generate_reel", async ({ messageId }) => { await generateReel(messageId); });
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    logger?.info("worker: configure Supabase to enable persisted jobs");
    return;
  }
  try {
    const jobs = await recoverJobs();
    for (const job of jobs) await queue.add("generate_reel", { messageId: job.message_id });
    logger?.info({ recovered: jobs.length }, "worker: ready");
  } catch {
    logger?.error("worker: job recovery failed; check the Supabase migration and configuration");
  }
}
