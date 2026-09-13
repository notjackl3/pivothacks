import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DeliveryPlan, MessageListItem } from "@reelrelay/shared";
import { requireUser } from "../../auth/requireUser.js";
import { getDb } from "../../db/client.js";
import { getMessage, listMessages } from "../../db/queries/messages.js";
import { getJob, releaseHeldJob, retryJob, type JobRow } from "../../db/queries/jobs.js";
import { getArtifact, type ArtifactRow } from "../../db/queries/artifacts.js";
import { signedArtifactUrl } from "../../render/upload.js";
import { queue } from "../../queue/memoryQueue.js";

const notFound = () => Object.assign(new Error("Message not found."), { statusCode: 404, code: "NOT_FOUND" });
const jobView = (job: JobRow) => ({ id: job.id, status: job.status, attemptCount: job.attempt_count, errorCode: job.error_code, errorDetail: job.error_detail, stageTimings: job.stage_timings, startedAt: job.started_at, completedAt: job.completed_at, deliveryPlan: job.delivery_plan ?? null, deliverAfter: job.deliver_after ?? null });
export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = async (request: Parameters<typeof requireUser>[0]) => { await requireUser(request); };
  app.get<{ Querystring: { limit?: string } }>("/api/messages", { preHandler: authenticate }, async (request) => {
    const limit = z.coerce.number().int().min(1).max(100).safeParse(request.query.limit ?? 50);
    if (!limit.success) throw Object.assign(new Error("limit must be between 1 and 100."), { statusCode: 400, code: "BAD_REQUEST" });
    const messages = await listMessages(request.userId, limit.data);
    if (messages.length === 0) return { items: [] };
    const ids = messages.map((message) => message.id);
    const [jobs, artifacts, drafts] = await Promise.all([
      getDb().from("processing_jobs").select("message_id,status,delivery_plan,deliver_after").in("message_id", ids),
      getDb().from("reel_artifacts").select("message_id,video_path,interpretation_json").in("message_id", ids),
      getDb().from("reply_drafts").select("message_id,status,created_at").eq("user_id", request.userId).in("message_id", ids).order("created_at", { ascending: false }),
    ]);
    for (const result of [jobs, artifacts, drafts]) if (result.error) throw result.error;
    const jobMap = new Map((jobs.data ?? []).map((row) => [row.message_id as string, row as { status: MessageListItem["jobStatus"]; delivery_plan: DeliveryPlan | null; deliver_after: string | null }]));
    const artifactMap = new Map((artifacts.data ?? []).map((row) => [row.message_id as string, row as Pick<ArtifactRow, "message_id" | "video_path" | "interpretation_json">]));
    const items: MessageListItem[] = messages.map((message) => {
      const artifact = artifactMap.get(message.id);
      const job = jobMap.get(message.id);
      return { id: message.id, sender: message.sender_display_name, preview: message.original_text.slice(0, 180), urgency: artifact?.interpretation_json.urgency ?? null, jobStatus: job?.status ?? "queued", isMock: message.is_mock, hasVideo: Boolean(artifact?.video_path), replyStatus: (drafts.data?.find((row) => row.message_id === message.id)?.status as MessageListItem["replyStatus"]) ?? null, receivedAt: message.received_at, deliveryMode: job?.delivery_plan?.mode ?? null, deliverAfter: job?.deliver_after ?? null, reasonText: job?.delivery_plan?.reasonText ?? null };
    });
    return { items };
  });
  app.get<{ Params: { id: string } }>("/api/messages/:id", { preHandler: authenticate }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.id).success) throw notFound();
    const message = await getMessage(request.userId, request.params.id);
    if (!message) throw notFound();
    const [job, artifact, drafts] = await Promise.all([
      getJob(message.id), getArtifact(message.id),
      getDb().from("reply_drafts").select("*").eq("user_id", request.userId).eq("message_id", message.id).order("created_at", { ascending: false }),
    ]);
    if (drafts.error) throw drafts.error;
    const [videoUrl, audioUrl] = await Promise.all([signedArtifactUrl(artifact?.video_path ?? null), signedArtifactUrl(artifact?.audio_path ?? null)]);
    return {
      message: { id: message.id, senderDisplayName: message.sender_display_name, senderExternalId: message.sender_external_id, originalText: message.original_text, externalMessageId: message.external_message_id, externalChannelId: message.external_channel_id, externalThreadId: message.external_thread_id, isMock: message.is_mock, source: message.is_mock ? "mock" : "slack", receivedAt: message.received_at },
      job: job ? jobView(job) : null,
      artifact: artifact ? { videoUrl, audioUrl, renderMode: artifact.render_mode, interpretation: artifact.interpretation_json, durationMs: artifact.duration_ms, deliveryMessageId: artifact.delivery_message_id } : null,
      drafts: (drafts.data ?? []).map((draft) => ({ id: draft.id, messageId: draft.message_id, userId: draft.user_id, userInputOriginal: draft.user_input_original, draftEnglish: draft.draft_english, meaningCheck: draft.meaning_check, tone: draft.tone, status: draft.status, approvedAt: draft.approved_at, sentExternalMessageId: draft.sent_external_message_id, errorDetail: draft.error_detail, createdAt: draft.created_at })),
    };
  });
  app.post<{ Params: { id: string } }>("/api/messages/:id/retry", { preHandler: authenticate }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.id).success) throw notFound();
    const message = await getMessage(request.userId, request.params.id);
    if (!message) throw notFound();
    const job = await retryJob(message.id);
    if (!job) throw Object.assign(new Error("Only failed jobs with fewer than three attempts can be retried."), { statusCode: 409, code: "RETRY_UNAVAILABLE" });
    await queue.add("generate_reel", { messageId: message.id });
    return { job: jobView(job) };
  });
  /** Pivot 03: "Deliver now" on a held job. The scheduler picks it up on its next tick (<= 10 s). */
  app.post<{ Params: { id: string } }>("/api/messages/:id/deliver-now", { preHandler: authenticate }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.id).success) throw notFound();
    const message = await getMessage(request.userId, request.params.id);
    if (!message) throw notFound();
    const job = await releaseHeldJob(message.id);
    if (!job) throw Object.assign(new Error("Only held jobs can be delivered early."), { statusCode: 409, code: "NOT_HELD" });
    return { job: jobView(job) };
  });
}
