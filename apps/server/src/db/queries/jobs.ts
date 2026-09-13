import type { JobStatus } from "@reelrelay/shared";
import { getDb } from "../client.js";

export type JobRow = {
  id: string; message_id: string; status: JobStatus; attempt_count: number;
  error_code: string | null; error_detail: string | null; stage_timings: Record<string, number>;
  started_at: string | null; completed_at: string | null; updated_at: string;
};
export async function getJob(messageId: string): Promise<JobRow | null> {
  const { data, error } = await getDb().from("processing_jobs").select("*").eq("message_id", messageId).maybeSingle();
  if (error) throw error;
  return data as JobRow | null;
}
export async function ensureJob(messageId: string): Promise<JobRow> {
  const { data, error } = await getDb().from("processing_jobs").upsert({ message_id: messageId }, { onConflict: "message_id", ignoreDuplicates: true }).select("*").maybeSingle();
  if (error) throw error;
  if (data) return data as JobRow;
  const existing = await getJob(messageId);
  if (!existing) throw new Error("Job could not be persisted.");
  return existing;
}
export async function claimJob(messageId: string): Promise<JobRow | null> {
  const job = await getJob(messageId);
  if (!job || job.status !== "queued" || job.attempt_count >= 3) return null;
  const { data, error } = await getDb().from("processing_jobs").update({ status: "analyzing", attempt_count: job.attempt_count + 1, started_at: new Date().toISOString(), completed_at: null, error_code: null, error_detail: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "queued").eq("attempt_count", job.attempt_count).select("*").maybeSingle();
  if (error) throw error;
  return data as JobRow | null;
}
export async function updateJob(messageId: string, patch: Partial<Omit<JobRow, "id" | "message_id">>): Promise<JobRow> {
  const { data, error } = await getDb().from("processing_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("message_id", messageId).select("*").single();
  if (error) throw error;
  return data as JobRow;
}
/** The caller must first resolve the message through getMessage(userId, messageId). */
export async function retryJob(messageId: string): Promise<JobRow | null> {
  const { data, error } = await getDb().from("processing_jobs").update({ status: "queued", completed_at: null, updated_at: new Date().toISOString() }).eq("message_id", messageId).eq("status", "failed").lt("attempt_count", 3).select("*").maybeSingle();
  if (error) throw error;
  return data as JobRow | null;
}
export async function recoverJobs(): Promise<JobRow[]> {
  // A delivery interrupted after the remote send is uncertain; do not auto-send it twice.
  const interrupted = await getDb().from("processing_jobs").update({ status: "failed", error_code: "DELIVERY_UNCERTAIN", error_detail: "Delivery was interrupted. Check Telegram before retrying.", updated_at: new Date().toISOString() }).eq("status", "delivering");
  if (interrupted.error) throw interrupted.error;
  const reset = await getDb().from("processing_jobs").update({ status: "queued", updated_at: new Date().toISOString() }).in("status", ["analyzing", "voicing", "rendering"]).lt("attempt_count", 3);
  if (reset.error) throw reset.error;
  const exhausted = await getDb().from("processing_jobs").update({ status: "failed", error_code: "INTERRUPTED", error_detail: "Processing was interrupted after the final attempt.", updated_at: new Date().toISOString() }).in("status", ["analyzing", "voicing", "rendering"]).gte("attempt_count", 3);
  if (exhausted.error) throw exhausted.error;
  const { data, error } = await getDb().from("processing_jobs").select("*").eq("status", "queued").order("updated_at", { ascending: true }).limit(1000);
  if (error) throw error;
  return data as JobRow[];
}
