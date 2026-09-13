import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/** Returns a human-readable configuration problem, or null when the browser client can be created. */
export function getSupabaseConfigError(): string | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return "NEXT_PUBLIC_SUPABASE_URL is not set";
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set";
  return null;
}

/**
 * Singleton Supabase client for client components. Sessions are stored in cookies by
 * @supabase/ssr so the auth callback route handler can complete the PKCE exchange.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(getSupabaseConfigError() ?? "Supabase is not configured");
  }
  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}
