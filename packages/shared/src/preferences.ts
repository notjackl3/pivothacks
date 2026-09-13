import { z } from "zod";
import { ReplyToneSchema } from "./interpretation.js";

export const UserPreferencesSchema = z.object({
  targetLanguage: z.string().default("zh-CN"),
  timezone: z.string().default("America/Toronto"),
  replyTone: ReplyToneSchema.default("respectful_student"),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
