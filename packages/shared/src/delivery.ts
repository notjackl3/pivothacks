// Pivot 03 (context). The Triage Router's output: how, when and in which tone a message reaches the student.
import { z } from "zod";
import { ReplyToneSchema } from "./interpretation.js";

export const SenderRelationshipSchema = z.enum(["professor", "employer", "landlord", "peer", "other"]);
export type SenderRelationship = z.infer<typeof SenderRelationshipSchema>;

export const DeliveryModeSchema = z.enum(["instant", "reel", "digest"]);
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;

export const DeliveryReasonSchema = z.enum([
  "urgency_high",
  "deadline_within_24h",
  "deadline_within_72h",
  "deadline_unknown",
  "sensitive_from_authority",
  "urgency_medium",
  "urgency_low",
  "quiet_hours",
  "digest_slot",
]);
export type DeliveryReason = z.infer<typeof DeliveryReasonSchema>;

export const DeliveryPlanSchema = z.object({
  mode: DeliveryModeSchema,
  /** ISO instant the reel may be delivered; null = immediately. */
  deliverAfter: z.string().nullable(),
  reasons: z.array(DeliveryReasonSchema).min(1).max(4),
  /** One human line in the student's language; shown in Telegram and History. */
  reasonText: z.string().min(1).max(160),
  /** Tone the reply draft uses unless the student overrides on Regenerate. */
  replyTone: ReplyToneSchema,
  /** Snapshot of the context that produced the plan, for History and the pitch. */
  context: z.object({
    urgency: z.enum(["low", "medium", "high"]),
    hoursToDeadline: z.number().nullable(),
    relationship: SenderRelationshipSchema,
    localTime: z.string(),
    timezone: z.string(),
    inQuietHours: z.boolean(),
  }),
});
export type DeliveryPlan = z.infer<typeof DeliveryPlanSchema>;
