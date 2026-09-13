import { z } from "zod";
import type { ComposioToolkit } from "@reelrelay/shared";
import { config } from "../../config.js";

export const ComposioToolkitSchema = z.enum(["gmail", "slack", "outlook", "whatsapp"]);
const StringMap = z.partialRecord(ComposioToolkitSchema, z.string().min(1));
const ConfigMap = z.partialRecord(ComposioToolkitSchema, z.record(z.string(), z.unknown()));

function parseJson<T>(raw: string, schema: z.ZodType<T>, name: string): T {
  try { return schema.parse(JSON.parse(raw)); }
  catch { throw Object.assign(new Error(`${name} must be valid JSON with supported toolkit keys.`), { code: "CONFIG_MISSING", statusCode: 503 }); }
}

export function composioAuthConfigs(): Partial<Record<ComposioToolkit, string>> {
  return parseJson(config.COMPOSIO_AUTH_CONFIGS, StringMap, "COMPOSIO_AUTH_CONFIGS");
}
export function composioTriggerSlugs(): Partial<Record<ComposioToolkit, string>> {
  return parseJson(config.COMPOSIO_TRIGGER_SLUGS, StringMap, "COMPOSIO_TRIGGER_SLUGS");
}
export function composioTriggerConfigs(): Partial<Record<ComposioToolkit, Record<string, unknown>>> {
  return parseJson(config.COMPOSIO_TRIGGER_CONFIGS, ConfigMap, "COMPOSIO_TRIGGER_CONFIGS");
}
export function configuredComposioToolkits(): ComposioToolkit[] {
  const auth = composioAuthConfigs(); const triggers = composioTriggerSlugs();
  return ComposioToolkitSchema.options.filter((toolkit) => Boolean(auth[toolkit] && triggers[toolkit]));
}
