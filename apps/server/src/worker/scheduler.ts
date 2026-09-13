// Pivot 03: releases `held` jobs when their deliver_after passes (quiet hours end, digest slot) and bundles digests per user.
import type { FastifyBaseLogger } from "fastify";
import { DeliveryPlanSchema, TimedInterpretationSchema, type ReelArtifact } from "@reelrelay/shared";
import { claimHeldJobs, updateJob, type JobRow } from "../db/queries/jobs.js";
import { getArtifact } from "../db/queries/artifacts.js";
import { getWorkerMessage } from "../db/queries/messages.js";
import { getDb } from "../db/client.js";
import { downloadArtifactFile } from "../render/upload.js";
import { captionsOnlyTiming, withTiming } from "../tts/timing.js";
import { defaultPipelineDependencies, deliverWithRetry, type PipelineDependencies } from "./generateReel.js";
import { schedulerNow } from "./clock.js";

export const SCHEDULER_INTERVAL_MS = 10_000;

function digestHeader(count: number, lang: string): string {
  return lang.startsWith("zh") ? `☀️ 你离开期间有 ${count} 条消息` : `☀️ ${count} message${count === 1 ? "" : "s"} while you were away`;
}

/** Rebuild the ReelArtifact for a stored job (video downloaded from Storage when present). */
async function artifactFor(job: JobRow, deps: Pick<PipelineDependencies, "download">): Promise<{ artifact: ReelArtifact; userId: string } | null> {
  const message = await getWorkerMessage(job.message_id);
  const stored = await getArtifact(job.message_id);
  if (!message || !stored) return null;
  const plan = DeliveryPlanSchema.safeParse(job.delivery_plan);
  const timed = TimedInterpretationSchema.safeParse(stored.interpretation_json);
  const interpretation = timed.success ? timed.data : withTiming(stored.interpretation_json, captionsOnlyTiming(stored.interpretation_json.spokenSegments));
  const videoPath = stored.video_path ? await deps.download(message.user_id, message.id, stored.video_path).catch(() => null) : null;
  const error = job.error_code && job.error_detail ? { code: job.error_code, message: job.error_detail } : undefined;
  return {
    userId: message.user_id,
    artifact: {
      messageId: message.id, videoPath, audioPath: null, durationMs: stored.duration_ms, renderMode: videoPath ? stored.render_mode : "text_only",
      interpretation, isMock: message.is_mock, senderDisplayName: message.sender_display_name, source: message.is_mock ? "mock" : "slack",
      originalText: message.original_text, error, plan: plan.success ? plan.data : undefined, replyToMessageId: stored.instant_message_id,
    },
  };
}

/** One tick. Exported so a test or the demo can call it directly. Returns the number of jobs delivered. */
export async function releaseHeldJobs(now = schedulerNow(), deps = defaultPipelineDependencies()): Promise<number> {
  const jobs = await claimHeldJobs(now);
  if (!jobs.length) return 0;
  const byUser = new Map<string, Array<{ job: JobRow; artifact: ReelArtifact }>>();
  for (const job of jobs) {
    try {
      const built = await artifactFor(job, deps);
      if (!built) { await updateJob(job.message_id, { status: "failed", error_code: "DELIVERY", error_detail: "Held artifact is missing.", completed_at: new Date().toISOString() }); continue; }
      const list = byUser.get(built.userId) ?? [];
      list.push({ job, artifact: built.artifact });
      byUser.set(built.userId, list);
    } catch (error) {
      await updateJob(job.message_id, { status: "failed", error_code: "DELIVERY", error_detail: "Held artifact could not be loaded.", completed_at: new Date().toISOString() });
      console.error("[scheduler] artifact load failed", { messageId: job.message_id, error: error instanceof Error ? error.name : "Unknown" });
    }
  }
  let delivered = 0;
  for (const [userId, items] of byUser) {
    const [connection, prefs] = await Promise.all([
      getDb().from("connections").select("external_account_id").eq("user_id", userId).eq("provider", "telegram").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      getDb().from("preferences").select("target_language").eq("user_id", userId).maybeSingle(),
    ]);
    const target = connection.data ? String(connection.data.external_account_id) : null;
    const digests = items.filter((item) => item.artifact.plan?.mode === "digest");
    if (target && digests.length > 1 && deps.delivery.sendText) {
      try { await deps.delivery.sendText(target, digestHeader(digests.length, String(prefs.data?.target_language ?? "zh-CN"))); } catch { /* header is cosmetic */ }
    }
    for (const { job, artifact } of items) {
      const degraded = Boolean(job.error_code);
      try {
        if (!target) throw Object.assign(new Error("Pair Telegram before delivery."), { code: "TELEGRAM_NOT_PAIRED" });
        await deliverWithRetry(deps, target, artifact);
        await updateJob(job.message_id, { status: degraded ? "failed" : "complete", completed_at: new Date().toISOString() });
        delivered++;
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "DELIVERY";
        await updateJob(job.message_id, { status: "failed", error_code: code, error_detail: code === "TELEGRAM_NOT_PAIRED" ? "Pair Telegram on the setup page, then retry." : "Telegram delivery failed. Check Telegram before retrying.", completed_at: new Date().toISOString() });
      }
    }
  }
  return delivered;
}

let timer: NodeJS.Timeout | undefined;
let ticking = false;
export function startScheduler(logger?: FastifyBaseLogger, intervalMs = SCHEDULER_INTERVAL_MS): void {
  if (timer) return;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const count = await releaseHeldJobs();
      if (count) logger?.info({ released: count }, "scheduler: delivered held reels");
    } catch (error) {
      logger?.error({ name: error instanceof Error ? error.name : "Unknown" }, "scheduler: tick failed");
    } finally { ticking = false; }
  };
  timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  void tick();
  logger?.info({ intervalMs }, "scheduler: watching held jobs");
}
export function stopScheduler(): void { if (timer) clearInterval(timer); timer = undefined; }
