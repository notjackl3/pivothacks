import { z } from "zod";
import type { MessageInterpretation, ReplyTone, TimedInterpretation } from "./interpretation.js";
import type { UserPreferences } from "./preferences.js";

export const NormalizedMessageSchema = z.object({
  provider: z.enum(["slack", "mock"]),
  connectionId: z.string().uuid(),
  externalMessageId: z.string(),
  externalChannelId: z.string(),
  externalThreadId: z.string().nullable(),
  senderExternalId: z.string(),
  senderDisplayName: z.string(),
  text: z.string().min(1),
  receivedAt: z.string().datetime(),
});
export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>;
export const JobStatusSchema = z.enum(["queued", "analyzing", "voicing", "rendering", "delivering", "complete", "failed"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type RenderMode = "remotion" | "captions_only" | "text_only";

export type TrackableEntity = {
  id: string;
  name: string;
  entityType: "person" | "channel";
};

/** File paths are local files for Telegram streaming. Storage paths live in DB rows. */
export type ReelArtifact = {
  messageId: string;
  videoPath: string | null;
  audioPath: string | null;
  durationMs: number | null;
  renderMode: RenderMode;
  interpretation: TimedInterpretation;
  isMock: boolean;
  senderDisplayName: string;
  source: "slack" | "mock";
  originalText: string;
  /** When set, show this notice and the original; do not label the content a translation. */
  error?: { code: string; message: string };
};

export type ConversationContext = {
  message: NormalizedMessage;
  interpretation: MessageInterpretation;
  preferences: UserPreferences;
  studentName?: string;
  previousThreadMessages?: string[];
};

export type ReplyDraftStatus = "draft" | "approved" | "sent" | "send_uncertain" | "cancelled" | "failed";
export type ReplyDraft = {
  id: string;
  messageId: string;
  userId: string;
  userInputOriginal: string;
  draftEnglish: string;
  meaningCheck: string | null;
  tone: ReplyTone;
  status: ReplyDraftStatus;
  approvedAt?: string | null;
  sentExternalMessageId?: string | null;
  errorDetail?: string | null;
  warnings?: string[];
};
