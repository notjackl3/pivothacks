import type { ComposioToolkit } from "@reelrelay/shared";
import { config, requireConfig } from "../../config.js";
import { composioAuthConfigs, composioTriggerConfigs, composioTriggerSlugs } from "./config.js";

interface ApiErrorBody { error?: { message?: string }; message?: string }
export interface ComposioLink { connectedAccountId: string; redirectUrl: string; expiresAt: string }
export interface ComposioAccount { id: string; status: string; toolkit: string | null }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = requireConfig("COMPOSIO_API_KEY");
  let response: Response;
  try {
    response = await fetch(`${config.COMPOSIO_API_BASE_URL}${path}`, {
      ...init,
      headers: { "x-api-key": apiKey, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : "Composio is unreachable."), { code: "COMPOSIO_UNREACHABLE", statusCode: 503 });
  }
  const body = await response.json().catch(() => ({})) as T & ApiErrorBody;
  if (!response.ok) throw Object.assign(new Error(body.error?.message ?? body.message ?? `Composio returned HTTP ${response.status}`), { code: "COMPOSIO_ERROR", statusCode: response.status >= 500 ? 503 : 400 });
  return body;
}

export async function createConnectLink(userId: string, toolkit: ComposioToolkit, callbackUrl: string): Promise<ComposioLink> {
  const authConfigId = composioAuthConfigs()[toolkit];
  if (!authConfigId) throw Object.assign(new Error(`${toolkit} is not configured in Composio.`), { code: "CONFIG_MISSING", statusCode: 503 });
  const body = await request<{ connected_account_id: string; redirect_url: string; expires_at: string }>("/api/v3/connected_accounts/link", {
    method: "POST", body: JSON.stringify({ user_id: userId, auth_config_id: authConfigId, callback_url: callbackUrl }),
  });
  return { connectedAccountId: body.connected_account_id, redirectUrl: body.redirect_url, expiresAt: body.expires_at };
}

export async function getConnectedAccount(id: string): Promise<ComposioAccount> {
  const body = await request<{ id?: string; nanoid?: string; status: string; toolkit?: { slug?: string } }>(`/api/v3/connected_accounts/${encodeURIComponent(id)}`);
  return { id: body.nanoid ?? body.id ?? id, status: body.status, toolkit: body.toolkit?.slug ?? null };
}

export async function ensureInboundTrigger(toolkit: ComposioToolkit, connectedAccountId: string): Promise<string> {
  const slug = composioTriggerSlugs()[toolkit];
  if (!slug) throw Object.assign(new Error(`${toolkit} has no inbound trigger configured.`), { code: "CONFIG_MISSING", statusCode: 503 });
  const body = await request<{ trigger_id: string }>(`/api/v3.1/trigger_instances/${encodeURIComponent(slug)}/upsert`, {
    method: "POST",
    body: JSON.stringify({ connected_account_id: connectedAccountId, trigger_config: composioTriggerConfigs()[toolkit] ?? {}, toolkit_versions: "latest" }),
  });
  return body.trigger_id;
}
