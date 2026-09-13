import { DeliveryPlanSchema, MessageInterpretationSchema, SenderRelationshipSchema, TimedInterpretationSchema, UserPreferencesSchema, type ComprehensionEngine, type DeliveryConnector, type DeliveryPlan, type MessageInterpretation, type NormalizedMessage, type ReelArtifact, type ReelRenderer, type SenderRelationship, type UserPreferences } from "@reelrelay/shared";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { getWorkerMessage, normalizeStoredMessage, type MessageRow } from "../db/queries/messages.js";
import { claimJob, updateJob, type JobRow } from "../db/queries/jobs.js";
import { getArtifact, saveArtifact, setDeliveryId, setInstantMessageId, type ArtifactRow } from "../db/queries/artifacts.js";
import { getDelivery } from "../delivery/index.js";
import { getEngine, analyzeShorter } from "../engine/index.js";
import { checkFaithfulness } from "../engine/faithfulness.js";
import { synthesizeSpeech, type SpeechResult } from "../tts/elevenlabs.js";
import { captionsOnlyTiming, withTiming } from "../tts/timing.js";
import { downloadArtifactFile, uploadArtifactFile } from "../render/upload.js";
import { RemotionRenderer } from "../render/RemotionRenderer.js";
import { decideDelivery } from "./decideDelivery.js";
import { nowFor } from "./clock.js";

export type PipelineProfile = { prefs: UserPreferences; target: string; relationship: SenderRelationship };
export interface PipelineRepository {
  getMessage(id: string): Promise<MessageRow | null>;
  claim(id: string): Promise<JobRow | null>;
  update(id: string, patch: Partial<JobRow>): Promise<JobRow>;
  getArtifact(id: string): Promise<ArtifactRow | null>;
  saveArtifact: typeof saveArtifact;
  setDeliveryId(id: string, deliveryId: string): Promise<void>;
  setInstantMessageId(id: string, instantMessageId: string): Promise<void>;
  profile(userId: string, message: MessageRow): Promise<PipelineProfile>;
}
export type PipelineDependencies = {
  repository: PipelineRepository;
  engine: ComprehensionEngine;
  delivery: DeliveryConnector;
  speech: (interp: MessageInterpretation, id: string) => Promise<SpeechResult>;
  renderer: (message: MessageRow, audioPath: string | null) => ReelRenderer;
  upload: typeof uploadArtifactFile;
  download: typeof downloadArtifactFile;
  shorten: (message: NormalizedMessage, prefs: UserPreferences) => Promise<MessageInterpretation>;
  mode: "video" | "text";
  pause: (ms: number) => Promise<void>;
  /** Pivot 03: clock used for the triage decision (demo override aware). */
  now: (messageId: string) => Date;
};
const defaultRepository: PipelineRepository = {
  getMessage: getWorkerMessage, claim: claimJob, update: updateJob, getArtifact, saveArtifact, setDeliveryId, setInstantMessageId,
  async profile(userId, message) {
    const results = await Promise.all([
      getDb().from("preferences").select("target_language,timezone,reply_tone,quiet_start,quiet_end").eq("user_id", userId).single(),
      getDb().from("connections").select("external_account_id").eq("user_id", userId).eq("provider", "telegram").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      getDb().from("tracked_entities").select("relationship").eq("connection_id", message.connection_id).eq("external_entity_id", message.sender_external_id).maybeSingle(),
    ]);
    const preferences = results[0]; const connection = results[1]; const entity = results[2];
    if (!preferences || !connection) throw new Error("Profile unavailable.");
    if (preferences.error) throw preferences.error;
    if (connection.error) throw connection.error;
    if (!connection.data) throw Object.assign(new Error("Pair Telegram before generating a reel."), { code: "TELEGRAM_NOT_PAIRED" });
    const relationship = SenderRelationshipSchema.safeParse(entity.data?.relationship);
    return {
      prefs: UserPreferencesSchema.parse({ targetLanguage: preferences.data.target_language, timezone: preferences.data.timezone, replyTone: preferences.data.reply_tone, quietStart: preferences.data.quiet_start ?? undefined, quietEnd: preferences.data.quiet_end ?? undefined }),
      target: String(connection.data.external_account_id),
      relationship: relationship.success ? relationship.data : "other",
    };
  },
};
export function defaultPipelineDependencies(): PipelineDependencies {
  return {
    repository: defaultRepository, engine: getEngine(), delivery: getDelivery(), speech: synthesizeSpeech,
    renderer: (message, audioPath) => new RemotionRenderer({ messageId: message.id, senderDisplayName: message.sender_display_name, source: message.source_provider ?? (message.is_mock ? "mock" : "slack"), isMock: message.is_mock, originalText: message.original_text, audioPath }),
    upload: uploadArtifactFile, download: downloadArtifactFile, shorten: analyzeShorter,
    mode: config.PIPELINE_MODE, pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: nowFor,
  };
}
const safeError = (error: unknown, defaultCode: string) => {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : defaultCode;
  const messages: Record<string, string> = {
    LLM_INVALID: "Translation unavailable. Review the original and try again.",
    LLM_REFUSED: "Translation unavailable. Review the original and try again.",
    CONFIG_MISSING: "A required service has not been configured.",
    TELEGRAM_NOT_PAIRED: "Pair Telegram on the setup page, then retry.",
    RENDER: "Video rendering failed. The complete text card is available; retry to generate a video.",
    NARRATION_TOO_LONG: "The complete narration exceeds 60 seconds. The text card includes all instructions.",
    DELIVERY: "Telegram delivery failed. Check Telegram before retrying.",
    STORAGE: "Artifact storage is unavailable. Please retry.",
  };
  return { code, message: messages[code] ?? "Processing failed. Please try again." };
};

/** sendReel with the worker's 4× retry (1 s, 3 s, 9 s). Persists the delivery id outside the retry loop. Shared with the scheduler. */
export async function deliverWithRetry(deps: Pick<PipelineDependencies, "delivery" | "pause" | "repository">, target: string, artifact: ReelArtifact): Promise<string> {
  let deliveryId: string | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await deps.pause([1000, 3000, 9000][attempt - 1]!);
    try { deliveryId = await deps.delivery.sendReel(target, artifact); break; } catch (error) { lastError = error; }
  }
  if (!deliveryId) throw Object.assign(new Error("Telegram delivery failed."), { code: "DELIVERY", cause: lastError });
  // Keep persistence outside the retry loop: a DB write failure must not re-send the video.
  await deps.repository.setDeliveryId(artifact.messageId, deliveryId);
  return deliveryId;
}

/** Pivot 03: the instant text card. Uses the connector's sendInstantCard when it has one; otherwise a text_only reel (which every connector renders as a card). */
async function sendInstantCard(deps: Pick<PipelineDependencies, "delivery">, target: string, card: ReelArtifact, plan: DeliveryPlan): Promise<string> {
  if (deps.delivery.sendInstantCard) return deps.delivery.sendInstantCard(target, card, plan);
  return deps.delivery.sendReel(target, card);
}

/** No Slack connector is reachable from this pipeline; replies belong to Dev B's approval handler. */
export async function generateReel(messageId: string, deps = defaultPipelineDependencies()): Promise<void> {
  const repo = deps.repository;
  const message = await repo.getMessage(messageId);
  if (!message) return;
  const claimed = await repo.claim(messageId);
  if (!claimed) return;
  const timings = { ...claimed.stage_timings };
  let currentStage = "analyzing";
  let target: string | undefined;
  let interpretation: MessageInterpretation | undefined;
  let degraded: { code: string; message: string } | undefined;
  const runStage = async <T>(stage: "analyzing" | "notifying" | "voicing" | "rendering" | "delivering", run: () => Promise<T>): Promise<T> => {
    currentStage = stage;
    await repo.update(messageId, { status: stage });
    const started = performance.now();
    try { return await run(); }
    finally {
      timings[stage] = Math.round((timings[stage] ?? 0) + performance.now() - started);
      await repo.update(messageId, { stage_timings: { ...timings } });
    }
  };
  try {
    const profile = await repo.profile(message.user_id, message);
    target = profile.target;
    const normalized = normalizeStoredMessage(message);
    let stored = await repo.getArtifact(messageId);
    const parsed = MessageInterpretationSchema.safeParse(stored?.interpretation_json);
    if (parsed.success && !checkFaithfulness(message.original_text, parsed.data).length) {
      interpretation = parsed.data;
    } else {
      interpretation = await runStage("analyzing", () => deps.engine.analyze(normalized, profile.prefs, { relationship: profile.relationship }));
      MessageInterpretationSchema.parse(interpretation);
      if (checkFaithfulness(message.original_text, interpretation).length) throw Object.assign(new Error("Interpretation failed checks."), { code: "LLM_INVALID" });
      stored = await repo.saveArtifact(messageId, { interpretation_json: interpretation, render_mode: "text_only", audio_path: null, video_path: null, duration_ms: null, delivery_message_id: null });
    }

    // ── Pivot 03: the Triage Router. Context decides the path; the plan is persisted so History and Telegram can explain it. ──
    const existingPlan = DeliveryPlanSchema.safeParse(claimed.delivery_plan);
    const plan: DeliveryPlan = existingPlan.success ? existingPlan.data : decideDelivery({ interpretation, relationship: profile.relationship, prefs: profile.prefs, now: deps.now(messageId) });
    if (!existingPlan.success) await repo.update(messageId, { delivery_plan: plan, deliver_after: plan.deliverAfter });
    const baseArtifact = (_interp: MessageInterpretation): Omit<ReelArtifact, "videoPath" | "audioPath" | "durationMs" | "renderMode" | "interpretation"> => ({
      messageId, isMock: message.is_mock, source: message.source_provider ?? (message.is_mock ? "mock" : "slack"), senderDisplayName: message.sender_display_name, originalText: message.original_text, plan,
      replyToMessageId: stored?.instant_message_id ?? null,
    });
    let instantMessageId: string | null = stored?.instant_message_id ?? null;
    if (plan.mode === "instant" && !instantMessageId) {
      // Deliver-then-render: the actions reach the student in seconds; the reel threads under this card when it is ready.
      const cardInterp = withTiming(interpretation, captionsOnlyTiming(interpretation.spokenSegments));
      const card: ReelArtifact = { ...baseArtifact(interpretation), videoPath: null, audioPath: null, durationMs: null, renderMode: "text_only", interpretation: cardInterp, replyToMessageId: null };
      await runStage("notifying", async () => {
        try {
          instantMessageId = await sendInstantCard(deps, target!, card, plan);
          await repo.setInstantMessageId(messageId, instantMessageId);
        } catch (error) {
          // Non-fatal: the reel still ships; the failure is visible in stage timings and logs.
          console.warn(`[worker] instant card failed for ${messageId}: ${error instanceof Error ? error.message : "unknown"}`);
        }
      });
    }

    let timed = TimedInterpretationSchema.safeParse(stored?.interpretation_json);
    let audioPath: string | null = null;
    let videoPath: string | null = null;
    if (stored?.video_path && timed.success) videoPath = await deps.download(message.user_id, messageId, stored.video_path);
    if (stored?.audio_path && timed.success && !videoPath) audioPath = await deps.download(message.user_id, messageId, stored.audio_path);
    if (deps.mode === "video" && !videoPath && !(timed.success && (audioPath || stored?.render_mode === "captions_only"))) {
      let speech = await runStage("voicing", () => deps.speech(interpretation!, messageId));
      if (speech.mode === "voiced" && speech.narrationMs > 40000) {
        interpretation = await runStage("analyzing", () => deps.shorten(normalized, profile.prefs));
        if (checkFaithfulness(message.original_text, interpretation).length) throw Object.assign(new Error("Shortened narration failed checks."), { code: "LLM_INVALID" });
        speech = await runStage("voicing", () => deps.speech(interpretation!, messageId));
      }
      audioPath = speech.audioPath;
      const result = withTiming(interpretation, speech);
      timed = { success: true, data: result };
      const audioStoragePath = audioPath ? await deps.upload(message.user_id, messageId, audioPath, "audio") : null;
      stored = await repo.saveArtifact(messageId, { interpretation_json: result, render_mode: speech.mode === "captions_only" ? "captions_only" : "text_only", audio_path: audioStoragePath, video_path: null, duration_ms: result.totalMs });
      if (speech.mode === "voiced" && speech.narrationMs > 60000) degraded = safeError(null, "NARRATION_TOO_LONG");
    }
    const timedInterpretation = timed.success ? timed.data : withTiming(interpretation, captionsOnlyTiming(interpretation.spokenSegments));
    let artifact: ReelArtifact = {
      ...baseArtifact(interpretation), messageId, videoPath, audioPath, durationMs: timedInterpretation.totalMs, renderMode: videoPath ? stored?.render_mode ?? "remotion" : "text_only",
      interpretation: timedInterpretation, replyToMessageId: instantMessageId,
    };
    if (deps.mode === "video" && !videoPath && !degraded) {
      try {
        const rendered = await runStage("rendering", () => deps.renderer(message, audioPath).render(timedInterpretation, profile.prefs));
        artifact = { ...rendered, plan, replyToMessageId: instantMessageId };
      } catch (error) {
        degraded = safeError(error, "RENDER");
        artifact = { ...artifact, renderMode: "text_only", videoPath: null, error: degraded };
      }
      if (artifact.videoPath) {
        const storagePath = await deps.upload(message.user_id, messageId, artifact.videoPath, "video");
        stored = await repo.saveArtifact(messageId, { interpretation_json: timedInterpretation, render_mode: artifact.renderMode, video_path: storagePath, audio_path: stored?.audio_path ?? null, duration_ms: artifact.durationMs });
      }
    }
    if (!artifact.videoPath) {
      artifact.error = degraded;
      await repo.saveArtifact(messageId, { interpretation_json: timedInterpretation, render_mode: "text_only", video_path: null, audio_path: stored?.audio_path ?? null, duration_ms: timedInterpretation.totalMs });
    }

    // ── Pivot 03: hold. Rendered and stored; the scheduler delivers at deliver_after (quiet hours end, digest slot). ──
    if (plan.deliverAfter && new Date(plan.deliverAfter).getTime() > deps.now(messageId).getTime()) {
      await repo.update(messageId, { status: "held", deliver_after: plan.deliverAfter, error_code: degraded?.code ?? null, error_detail: degraded?.message ?? null, stage_timings: timings });
      return;
    }
    await runStage("delivering", () => deliverWithRetry(deps, target!, artifact));
    await repo.update(messageId, { status: degraded ? "failed" : "complete", error_code: degraded?.code ?? null, error_detail: degraded?.message ?? null, stage_timings: timings, completed_at: new Date().toISOString() });
  } catch (error) {
    const problem = safeError(error, currentStage === "analyzing" ? "LLM_INVALID" : currentStage === "delivering" ? "DELIVERY" : "PROCESSING");
    await repo.update(messageId, { status: "failed", error_code: problem.code, error_detail: problem.message, stage_timings: timings, completed_at: new Date().toISOString() });
    if (target && !interpretation && currentStage === "analyzing") {
      const originalOnly: MessageInterpretation = {
        sourceLanguage: "und", targetLanguage: "und", faithfulTranslation: message.original_text,
        shortTitle: "Translation unavailable", hook: "Please review the original message.",
        spokenSegments: ["Translation unavailable.", "Please open Original to read the complete source message."],
        senderIntent: "Translation is unavailable; no interpretation was produced.", urgency: "medium", isSensitive: true,
        actionItems: [], preservedFacts: [], ambiguities: ["Translation unavailable."], suggestedClarifyingQuestions: [],
      };
      try {
        await deps.delivery.sendReel(target, { messageId, videoPath: null, audioPath: null, durationMs: null, renderMode: "text_only", interpretation: withTiming(originalOnly, captionsOnlyTiming(originalOnly.spokenSegments)), isMock: message.is_mock, senderDisplayName: message.sender_display_name, source: message.source_provider ?? (message.is_mock ? "mock" : "slack"), originalText: message.original_text, error: problem });
      } catch { /* The failure is persisted; a delivery outage must not lose the job status. */ }
    }
  }
}
