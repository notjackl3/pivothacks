// Dev B. GET /api/preferences → UserPreferences; PATCH /api/preferences (partial) → full UserPreferences.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ReplyToneSchema, type PreferencesResponse } from "@reelrelay/shared";
import { requireUser } from "../../auth/requireUser.js";
import { getPreferences, updatePreferences } from "../../db/queries/preferences.js";

/** Accepts every IANA zone the runtime knows (plus "UTC"); anything else would break due-date formatting downstream. */
function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

const PatchPreferencesBody = z
  .object({
    targetLanguage: z.string().trim().min(2).max(12).optional(),
    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, { message: "Unknown IANA time zone" }).optional(),
    replyTone: ReplyToneSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one of targetLanguage, timezone, replyTone",
  });

export async function registerPreferencesRoutes(api: FastifyInstance): Promise<void> {
  api.get("/api/preferences", async (req) => {
    const userId = await requireUser(req);
    return (await getPreferences(userId)) satisfies PreferencesResponse;
  });

  api.patch("/api/preferences", async (req) => {
    const userId = await requireUser(req);
    const patch = PatchPreferencesBody.parse(req.body ?? {});
    return (await updatePreferences(userId, patch)) satisfies PreferencesResponse;
  });
}
