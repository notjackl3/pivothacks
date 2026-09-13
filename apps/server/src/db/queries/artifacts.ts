import type { MessageInterpretation, RenderMode, TimedInterpretation } from "@reelrelay/shared";
import { getDb } from "../client.js";

export type ArtifactRow = {
  id: string; message_id: string; interpretation_json: MessageInterpretation | TimedInterpretation;
  audio_path: string | null; video_path: string | null; duration_ms: number | null;
  render_mode: RenderMode; delivery_message_id: string | null; created_at: string;
  /** Pivot 03: Telegram id of the instant card (mode=instant), sent before rendering. */
  instant_message_id: string | null;
};
export async function getArtifact(messageId: string): Promise<ArtifactRow | null> {
  const { data, error } = await getDb().from("reel_artifacts").select("*").eq("message_id", messageId).maybeSingle();
  if (error) throw error;
  return data as ArtifactRow | null;
}
export async function saveArtifact(messageId: string, patch: Partial<Omit<ArtifactRow, "id" | "message_id" | "created_at">> & { interpretation_json: ArtifactRow["interpretation_json"]; render_mode: RenderMode }): Promise<ArtifactRow> {
  const { data, error } = await getDb().from("reel_artifacts").upsert({ message_id: messageId, ...patch }, { onConflict: "message_id" }).select("*").single();
  if (error) throw error;
  return data as ArtifactRow;
}
export async function setDeliveryId(messageId: string, deliveryMessageId: string): Promise<void> {
  const { error } = await getDb().from("reel_artifacts").update({ delivery_message_id: deliveryMessageId }).eq("message_id", messageId);
  if (error) throw error;
}
export async function setInstantMessageId(messageId: string, instantMessageId: string): Promise<void> {
  const { error } = await getDb().from("reel_artifacts").update({ instant_message_id: instantMessageId }).eq("message_id", messageId);
  if (error) throw error;
}
