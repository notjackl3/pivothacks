import { z } from "zod";

export const ReplyToneSchema = z.enum(["respectful_student", "concise_professional", "warm", "direct"]);
export type ReplyTone = z.infer<typeof ReplyToneSchema>;

export const ActionItemSchema = z.object({
  text: z.string().min(1).max(120),
  textEnglish: z.string().min(1).max(120),
  isNegation: z.boolean(),
  essential: z.boolean(),
  dueText: z.string().nullable(),
  dueAt: z.string().nullable(),
  evidenceQuote: z.string().min(1),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const MessageInterpretationSchema = z.object({
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  faithfulTranslation: z.string().min(1),
  hook: z.string().min(1).max(60),
  spokenSegments: z.array(z.string().min(1).max(60)).min(2).max(30),
  shortTitle: z.string().min(1).max(60),
  senderIntent: z.string().min(1).max(300),
  urgency: z.enum(["low", "medium", "high"]),
  isSensitive: z.boolean(),
  actionItems: z.array(ActionItemSchema).min(0).max(10),
  preservedFacts: z.array(z.object({ label: z.string(), value: z.string() })).max(20),
  ambiguities: z.array(z.string()).max(6),
  suggestedClarifyingQuestions: z.array(z.string()).max(4),
});
export type MessageInterpretation = z.infer<typeof MessageInterpretationSchema>;

export const CaptionSegmentSchema = z.object({ text: z.string(), startMs: z.number().int(), endMs: z.number().int() });
export type CaptionSegment = z.infer<typeof CaptionSegmentSchema>;
export const TimedInterpretationSchema = MessageInterpretationSchema.extend({
  captionSegments: z.array(CaptionSegmentSchema).min(1),
  narrationMs: z.number().int().positive(),
  totalMs: z.number().int().positive(),
});
export type TimedInterpretation = z.infer<typeof TimedInterpretationSchema>;

export const ReplyDraftOutputSchema = z.object({
  detectedInputLanguage: z.string(),
  draftEnglish: z.string().min(1).max(1500),
  meaningCheck: z.string().max(300),
  warnings: z.array(z.string()).max(3),
});
export type ReplyDraftOutput = z.infer<typeof ReplyDraftOutputSchema>;
