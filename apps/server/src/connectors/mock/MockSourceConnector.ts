import { z } from "zod";
import type { NormalizedMessage, SourceConnector, TrackableEntity } from "@reelrelay/shared";

export const fixtureNames = ["professor_deadline", "landlord_docs", "manager_steps", "ambiguous_date", "bilingual", "negation"] as const;
const EnvelopeSchema = z.object({ event: z.object({ text: z.string().min(1), channel: z.string(), user: z.string(), ts: z.string(), thread_ts: z.string().optional() }) });
export class MockSourceConnector implements SourceConnector {
  constructor(private readonly connectionId: string, private readonly senderDisplayName: string) {}
  async connect(_userId: string): Promise<{ authorizeUrl: string }> { throw new Error("Demo messages are injected through /api/demo/inject; OAuth is not used."); }
  async listTrackableEntities(_connectionId: string): Promise<TrackableEntity[]> { return [{ id: "U0000PROFESSOR", name: this.senderDisplayName, entityType: "person" }]; }
  verifyWebhook(_rawBody: string, _headers: Record<string, string>): boolean { return false; }
  normalizeEvent(payload: unknown): NormalizedMessage | null {
    const parsed = EnvelopeSchema.safeParse(payload);
    if (!parsed.success) return null;
    const event = parsed.data.event;
    return { provider: "mock", connectionId: this.connectionId, externalMessageId: `${event.channel}:${event.ts}`, externalChannelId: event.channel, externalThreadId: event.thread_ts ?? null, senderExternalId: event.user, senderDisplayName: this.senderDisplayName, text: event.text, receivedAt: new Date().toISOString() };
  }
  async sendReply(_message: NormalizedMessage, _text: string): Promise<{ externalMessageId: string }> { throw new Error("A demo-injected message has no real Slack destination."); }
}
