import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireConfig } from "../config.js";

let client: SupabaseClient | undefined;
export function getDb(): SupabaseClient {
  client ??= createClient(requireConfig("SUPABASE_URL"), requireConfig("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/** Lazy compatibility export: the scaffold can boot before the keys are configured. */
export const db = new Proxy({} as SupabaseClient, {
  get(_target, key) {
    const value: unknown = Reflect.get(getDb(), key);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});
export const supabase = db;
