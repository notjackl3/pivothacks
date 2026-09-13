import type { JobStatus, ReplyDraftStatus } from "./messages.js";

export type ApiError = { error: { code: string; message: string } };
export type MessageListItem = {
  id: string;
  sender: string;
  preview: string;
  urgency: "low" | "medium" | "high" | null;
  jobStatus: JobStatus;
  isMock: boolean;
  hasVideo: boolean;
  replyStatus: ReplyDraftStatus | null;
  receivedAt: string;
};
export type MessageListResponse = { items: MessageListItem[] };
export type DemoInjectResponse = { messageId: string; jobId: string; isMock: true };

// Dev B may append endpoint types here without changing the existing exports.

// ───────────────────────────── Dev B (append-only): connectors + web ─────────────────────────────
// Everything below is appended by Dev B. Types marked "expected from Dev A" describe the response shapes the web app
// consumes from Dev A's endpoints (PLAN.md §9); Dev A's implementation should conform or tell Dev B.

import type { RenderMode, ReplyDraft } from "./messages.js";
import type { MessageInterpretation } from "./interpretation.js";
import type { UserPreferences } from "./preferences.js";

/** Alias of Dev A's ApiError envelope, under the name Dev B's code uses. */
export type ApiErrorBody = ApiError;
/** Alias of Dev A's list response, under the name Dev B's web client uses. */
export type MessagesListResponse = MessageListResponse;

/** A reply_drafts row including timestamps (superset of ReplyDraft). Dev A's history detail returns createdAt only. */
export interface ReplyDraftRecord extends ReplyDraft {
  approvedAt: string | null;
  sentExternalMessageId: string | null;
  errorDetail: string | null;
  createdAt: string;
  updatedAt?: string;
}

// ---- Shapes of Dev A's endpoints as implemented in routes/api/messages.ts (kept in sync by Dev B for the web app) ----

export interface MessageDetailResponse {
  message: {
    id: string;
    senderDisplayName: string;
    senderExternalId: string;
    originalText: string;
    externalMessageId: string;
    externalChannelId: string;
    externalThreadId: string | null;
    isMock: boolean;
    source: "slack" | "mock";
    receivedAt: string;
  };
  job: {
    id: string;
    status: JobStatus;
    attemptCount: number;
    errorCode: string | null;
    errorDetail: string | null;
    stageTimings: Record<string, number>;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  artifact: {
    videoUrl: string | null;
    audioUrl: string | null;
    renderMode: RenderMode;
    interpretation: MessageInterpretation;
    durationMs: number | null;
    deliveryMessageId: string | null;
  } | null;
  drafts: ReplyDraftRecord[];
}
/** POST /api/messages/:id/retry → { job }; 409 code RETRY_UNAVAILABLE unless failed with < 3 attempts. */
export interface RetryJobResponse {
  job: NonNullable<MessageDetailResponse["job"]>;
}
/** POST /api/demo/inject (header x-demo-secret). */
export interface DemoInjectRequest {
  fixture: string;
  userId: string;
}

// ---- Dev B endpoints ----

export type ConnectionMode = "user_token" | "bot_token";
export type ConnectionStatus = "active" | "revoked" | "error";

export interface SlackIntegrationState {
  connected: boolean;
  connectionId: string;
  teamId: string;
  teamName: string | null;
  userName: string | null;
  mode: ConnectionMode;
  status: ConnectionStatus;
  scopes: string[];
}
export interface TelegramIntegrationState {
  connected: boolean;
  connectionId: string;
  chatId: string;
}
export interface IntegrationsResponse {
  slack: SlackIntegrationState | null;
  telegram: TelegramIntegrationState | null;
}

export interface SlackStartResponse {
  url: string;
}

export interface EntityPerson {
  id: string;
  name: string;
}
export interface EntitiesResponse {
  people: EntityPerson[];
}

export interface TrackedEntity {
  id: string;
  connectionId: string;
  entityType: "person" | "channel";
  externalEntityId: string;
  displayName: string;
  enabled: boolean;
}
export interface PutTrackedEntityRequest {
  connectionId: string;
  externalEntityId: string;
  displayName: string;
  /** Defaults to "person". "channel" is only used in bot mode (PLAN.md §10). */
  entityType?: "person" | "channel";
}
export interface PutTrackedEntityResponse {
  entity: TrackedEntity;
}
export interface TrackedEntitiesResponse {
  entities: TrackedEntity[];
}

export interface PairingCodeResponse {
  code: string;
  expiresAt: string;
  deepLink: string;
}

export type PreferencesResponse = UserPreferences;
export type PatchPreferencesRequest = Partial<UserPreferences>;

export interface ApproveReplyResponse {
  draft: {
    id: string;
    status: ReplyDraftStatus;
    approvedAt: string | null;
    sentExternalMessageId: string | null;
    channel: string | null;
    threadTs: string | null;
    errorDetail?: string | null;
  };
}
export interface RegenerateReplyRequest {
  tone?: UserPreferences["replyTone"];
}
export interface RegenerateReplyResponse {
  draft: ReplyDraftRecord;
}
/** POST /api/replies/:id/retry-send — re-send from `failed` / `send_uncertain` (PLAN.md §15). */
export type RetrySendReplyResponse = ApproveReplyResponse;

export interface DeleteIntegrationResponse {
  deleted: true;
}
