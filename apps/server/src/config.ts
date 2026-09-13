import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
for (const file of ["apps/server/.env", ".env.local", ".env"]) {
  loadDotEnv({ path: path.join(repoRoot, file), quiet: true });
}
const optionalString = z.preprocess((v) => v === "" ? undefined : v, z.string().optional());
const optionalUrl = z.preprocess((v) => v === "" ? undefined : v, z.string().url().optional());
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_API_BASE_URL: optionalUrl,
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.string().default("reels"),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SLACK_CLIENT_ID: optionalString,
  SLACK_CLIENT_SECRET: optionalString,
  SLACK_SIGNING_SECRET: optionalString,
  SLACK_REDIRECT_URI: z.string().url().default("http://localhost:4000/api/integrations/slack/callback"),
  SLACK_USER_SCOPES: z.string().default("im:history,im:read,users:read,chat:write"),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_BOT_USERNAME: z.string().default("reelrelay_demo_bot"),
  INSTAGRAM_ACCOUNT_ID: optionalString,
  INSTAGRAM_USERNAME: optionalString,
  INSTAGRAM_ACCESS_TOKEN: optionalString,
  INSTAGRAM_APP_SECRET: optionalString,
  INSTAGRAM_VERIFY_TOKEN: optionalString,
  INSTAGRAM_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
  COMPOSIO_API_KEY: optionalString,
  COMPOSIO_WEBHOOK_SECRET: optionalString,
  /** JSON maps toolkit -> Composio auth config id, for example {"gmail":"ac_..."}. */
  COMPOSIO_AUTH_CONFIGS: z.string().default("{}"),
  /** JSON maps toolkit -> inbound trigger slug. */
  COMPOSIO_TRIGGER_SLUGS: z.string().default("{}"),
  /** Optional JSON maps toolkit -> trigger config; Gmail commonly uses query/labelIds/interval. */
  COMPOSIO_TRIGGER_CONFIGS: z.string().default("{}"),
  COMPOSIO_API_BASE_URL: z.string().url().default("https://backend.composio.dev"),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium"]).default("medium"),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_MODEL_ID: z.string().default("eleven_multilingual_v2"),
  ELEVENLABS_VOICE_ID: optionalString,
  TOKEN_ENCRYPTION_KEY: optionalString,
  OAUTH_STATE_SECRET: optionalString,
  DEMO_INJECT_SECRET: optionalString,
  RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(150000),
  REEL_WIDTH: z.coerce.number().int().positive().multipleOf(2).default(720),
  REEL_HEIGHT: z.coerce.number().int().positive().multipleOf(2).default(1280),
  ENGINE_MODE: z.enum(["live", "stub"]).default("live"),
  PIPELINE_MODE: z.enum(["video", "text"]).default("video"),
  DATA_DIR: z.string().default("build/reelrelay"),
});
export const config = EnvSchema.parse(process.env);
export const dataDir = path.resolve(repoRoot, config.DATA_DIR);
export function requireConfig<K extends keyof typeof config>(key: K): NonNullable<(typeof config)[K]> {
  const value = config[key];
  if (value === undefined || value === "") {
    throw Object.assign(new Error(`Missing server configuration: ${key}`), { code: "CONFIG_MISSING", statusCode: 503 });
  }
  return value as NonNullable<(typeof config)[K]>;
}
