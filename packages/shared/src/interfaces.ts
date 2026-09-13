import type { MessageInterpretation, ReplyDraftOutput, ReplyTone, TimedInterpretation } from "./interpretation.js";
import type { ConversationContext, NormalizedMessage, ReelArtifact, ReplyDraft, TrackableEntity } from "./messages.js";
import type { UserPreferences } from "./preferences.js";

export interface SourceConnector {
  connect(userId: string): Promise<{ authorizeUrl: string }>;
  listTrackableEntities(connectionId: string): Promise<TrackableEntity[]>;
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;
  normalizeEvent(payload: unknown): NormalizedMessage | null;
  sendReply(message: NormalizedMessage, text: string): Promise<{ externalMessageId: string }>;
}
export interface DeliveryConnector {
  pair(userId: string, pairingCode: string): Promise<void>;
  sendReel(deliveryTargetId: string, artifact: ReelArtifact): Promise<string>;
  sendDraft(deliveryTargetId: string, draft: ReplyDraft): Promise<string>;
}
export interface ComprehensionEngine {
  analyze(message: NormalizedMessage, prefs: UserPreferences): Promise<MessageInterpretation>;
  draftReply(ctx: ConversationContext, userInput: string, tone: ReplyTone): Promise<ReplyDraftOutput>;
}
export interface ReelRenderer {
  render(interp: TimedInterpretation, prefs: UserPreferences): Promise<ReelArtifact>;
}
export interface Queue {
  add(name: "generate_reel", data: { messageId: string }): Promise<void>;
  process(name: "generate_reel", handler: (d: { messageId: string }) => Promise<void>): void;
}
