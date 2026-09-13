import { z } from "zod";

const EventSchema = z.object({
  sender: z.object({ id: z.string().min(1) }),
  recipient: z.object({ id: z.string().min(1) }).optional(),
  timestamp: z.number().optional(),
  message: z.object({
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    quick_reply: z.object({ payload: z.string() }).optional(),
  }).optional(),
  postback: z.object({ payload: z.string() }).optional(),
});

const EnvelopeSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ messaging: z.array(EventSchema).optional() })),
});

export interface InstagramInbound {
  senderId: string;
  text: string | null;
  actionPayload: string | null;
  timestamp: number | null;
}

export function parseInstagramInbounds(payload: unknown): InstagramInbound[] {
  const parsed = EnvelopeSchema.safeParse(payload);
  if (!parsed.success) return [];
  const result: InstagramInbound[] = [];
  for (const entry of parsed.data.entry) {
    for (const event of entry.messaging ?? []) {
      if (event.message?.is_echo) continue;
      result.push({
        senderId: event.sender.id,
        text: event.message?.text?.trim() || null,
        actionPayload: event.message?.quick_reply?.payload ?? event.postback?.payload ?? null,
        timestamp: event.timestamp ?? null,
      });
    }
  }
  return result;
}
