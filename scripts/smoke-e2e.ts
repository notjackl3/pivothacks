import { setTimeout as pause } from "node:timers/promises";
import { getJob } from "../apps/server/src/db/queries/jobs.js";
import { demoUserId, injectDemo } from "./inject-demo.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.info("pnpm smoke:e2e [--user <Supabase UUID>]\nInjects three clearly labeled demo messages and reports wall time and persisted per-stage timings for the pitch.");
    return;
  }
  const userId = await demoUserId(args);
  for (let run = 1; run <= 3; run++) {
    const start = performance.now();
    const { messageId } = await injectDemo("professor_deadline", userId);
    while (performance.now() - start < 300000) {
      const job = await getJob(messageId);
      if (job && ["complete", "failed"].includes(job.status)) {
        console.info(JSON.stringify({ run, messageId, status: job.status, totalMs: Math.round(performance.now() - start), stageTimings: job.stage_timings, errorCode: job.error_code }));
        if (job.status === "failed") process.exitCode = 1;
        break;
      }
      await pause(1000);
    }
    if (performance.now() - start >= 300000) throw new Error(`Run ${run} exceeded five minutes; inspect History before retrying.`);
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Latency measurement failed."); process.exitCode = 1; });
