import type {
  ApiErrorBody,
  ApproveReplyResponse,
  ConnectionMode,
  DeleteIntegrationResponse,
  EntitiesResponse,
  IntegrationsResponse,
  MessageDetailResponse,
  MessagesListResponse,
  PairingCodeResponse,
  PatchPreferencesRequest,
  PreferencesResponse,
  PutTrackedEntityRequest,
  PutTrackedEntityResponse,
  RegenerateReplyRequest,
  RegenerateReplyResponse,
  ReplyTone,
  RetryJobResponse,
  RetrySendReplyResponse,
  SlackStartResponse,
  TrackedEntitiesResponse,
} from "@reelrelay/shared";
import { getSupabaseBrowserClient } from "./supabase/client";

/** Every call goes through the Next route handler so the Fastify API needs no CORS. */
const PROXY_PREFIX = "/api/proxy/";

/** Thrown for any non-2xx response; `code` comes from the `{ error: { code, message } }` envelope. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

/** Normalizes anything thrown by the client into a readable message for the UI. */
export function describeError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "api_unreachable") {
      return `${err.message} Check API_BASE_URL and that the server is running.`;
    }
    return err.message || err.code;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function extractErrorBody(json: unknown): ApiErrorBody["error"] | null {
  if (!json || typeof json !== "object") return null;
  const error = (json as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string") return null;
  return { code, message: typeof message === "string" ? message : code };
}

async function bearerToken(): Promise<string | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await bearerToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${PROXY_PREFIX}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (err) {
    throw new ApiClientError("network_error", err instanceof Error ? err.message : "Network error", 0);
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const envelope = extractErrorBody(json);
    if (envelope) throw new ApiClientError(envelope.code, envelope.message, res.status);
    const fallback = text && text.length < 200 ? text : res.statusText || `HTTP ${res.status}`;
    throw new ApiClientError(`http_${res.status}`, fallback, res.status);
  }

  return json as T;
}

function encodePath(...segments: string[]): string {
  return segments.map(encodeURIComponent).join("/");
}

// ───────────────────────────── integrations ─────────────────────────────

export function getIntegrations(): Promise<IntegrationsResponse> {
  return request<IntegrationsResponse>("GET", "integrations");
}

/** Begins Slack OAuth; the caller navigates the browser to `url`. `mode` defaults to the user-token flow. */
export function startSlack(mode?: ConnectionMode): Promise<SlackStartResponse> {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return request<SlackStartResponse>("GET", `integrations/slack/start${query}`);
}

export function deleteIntegration(connectionId: string): Promise<DeleteIntegrationResponse> {
  return request<DeleteIntegrationResponse>("DELETE", encodePath("integrations", connectionId));
}

// ───────────────────────────── entities ─────────────────────────────

export function getEntities(connectionId: string): Promise<EntitiesResponse> {
  return request<EntitiesResponse>("GET", encodePath("integrations", connectionId, "entities"));
}

export function getTrackedEntities(): Promise<TrackedEntitiesResponse> {
  return request<TrackedEntitiesResponse>("GET", "tracked-entities");
}

export function putTrackedEntity(body: PutTrackedEntityRequest): Promise<PutTrackedEntityResponse> {
  return request<PutTrackedEntityResponse>("PUT", "tracked-entities", body);
}

// ───────────────────────────── telegram ─────────────────────────────

export function createPairingCode(): Promise<PairingCodeResponse> {
  return request<PairingCodeResponse>("POST", "telegram/pairing-code", {});
}

// ───────────────────────────── preferences ─────────────────────────────

export function getPreferences(): Promise<PreferencesResponse> {
  return request<PreferencesResponse>("GET", "preferences");
}

export function patchPreferences(body: PatchPreferencesRequest): Promise<PreferencesResponse> {
  return request<PreferencesResponse>("PATCH", "preferences", body);
}

// ───────────────────────────── messages ─────────────────────────────

export function listMessages(limit = 50): Promise<MessagesListResponse> {
  return request<MessagesListResponse>("GET", `messages?limit=${encodeURIComponent(String(limit))}`);
}

export function getMessage(id: string): Promise<MessageDetailResponse> {
  return request<MessageDetailResponse>("GET", encodePath("messages", id));
}

export function retryMessage(id: string): Promise<RetryJobResponse> {
  return request<RetryJobResponse>("POST", encodePath("messages", id, "retry"), {});
}

// ───────────────────────────── replies ─────────────────────────────

export function approveReply(draftId: string): Promise<ApproveReplyResponse> {
  return request<ApproveReplyResponse>("POST", encodePath("replies", draftId, "approve"), {});
}

export function regenerateReply(draftId: string, tone?: ReplyTone): Promise<RegenerateReplyResponse> {
  const body: RegenerateReplyRequest = tone ? { tone } : {};
  return request<RegenerateReplyResponse>("POST", encodePath("replies", draftId, "regenerate"), body);
}

export function retrySendReply(draftId: string): Promise<RetrySendReplyResponse> {
  return request<RetrySendReplyResponse>("POST", encodePath("replies", draftId, "retry-send"), {});
}
