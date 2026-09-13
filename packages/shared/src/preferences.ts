import { z } from "zod";
import { ReplyToneSchema } from "./interpretation.js";

export const UserPreferencesSchema = z.object({
  targetLanguage: z.string().default("zh-CN"),
  timezone: z.string().default("America/Toronto"),
  replyTone: ReplyToneSchema.default("respectful_student"),
  /** Local HH:mm. Non-urgent deliveries are held while the clock is inside [quietStart, quietEnd). */
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).default("22:00"),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
