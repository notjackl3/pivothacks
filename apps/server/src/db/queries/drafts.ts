// Dev B. Queries for `reply_drafts`. The approval gate is `claimDraftForSend` (PLAN.md §4.5): one atomic conditional UPDATE.
import type { ReplyDraftRecord, ReplyDraftStatus, ReplyTone } from "@reelrelay/shared";
import { supabase } from "../client.js";

export interface DraftRow {
  id: string;
  message_id: string;
  user_id: string;
  user_input_original: string;
  draft_english: string;
  meaning_check: string | null;
  tone: ReplyTone;
  status: ReplyDraftStatus;
  approved_at: string | null;
  sent_external_message_id: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
}

const PREFIX_RE = /^[0-9a-f]{8}$/;

/** Query files must not import from routes; a coded error lets the API scope's handler map it to a 500 envelope. */
function dbError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 500, code: "db_error" });
}

/** Row → API object (camelCase). A row always carries its timestamps, hence ReplyDraftRecord rather than the bare ReplyDraft. */
export function toReplyDraft(row: DraftRow): ReplyDraftRecord {
  return {
    id: row.id,
    messageId: row.message_id,
    userId: row.user_id,
    userInputOriginal: row.user_input_original,
    draftEnglish: row.draft_english,
    meaningCheck: row.meaning_check ?? null,
    tone: row.tone,
    status: row.status,
    approvedAt: row.approved_at ?? null,
    sentExternalMessageId: row.sent_external_message_id ?? null,
    errorDetail: row.error_detail ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertDraft(input: {
  messageId: string;
  userId: string;
  userInputOriginal: string;
  draftEnglish: string;
  meaningCheck: string | null;
  tone: ReplyTone;
}): Promise<ReplyDraftRecord> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("reply_drafts")
    .insert({
      message_id: input.messageId,
      user_id: input.userId,
      user_input_original: input.userInputOriginal,
      draft_english: input.draftEnglish,
      meaning_check: input.meaningCheck,
      tone: input.tone,
      status: "draft",
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error) throw dbError(`reply_drafts insert failed: ${error.message}`);
  return toReplyDraft(data as DraftRow);
}

export async function getDraftForUser(draftId: string, userId: string): Promise<ReplyDraftRecord | null> {
  const { data, error } = await supabase.from("reply_drafts").select("*").eq("id", draftId).eq("user_id", userId).maybeSingle();
  if (error) throw dbError(`reply_drafts lookup failed: ${error.message}`);
  return data ? toReplyDraft(data as DraftRow) : null;
}

/** Resolve a callback id prefix (first 8 hex chars of the uuid) to the user's draft. Uses a uuid range filter
 * (`id >= p-0000-… AND id <= p-ffff-…`) so the PK index is used; picks the newest if more than one matches. */
export async function findDraftByPrefixForUser(prefix8: string, userId: string): Promise<ReplyDraftRecord | null> {
  const p = prefix8.toLowerCase();
  if (!PREFIX_RE.test(p)) return null;
  const { data, error } = await supabase
    .from("reply_drafts")
    .select("*")
    .eq("user_id", userId)
    .gte("id", `${p}-0000-0000-0000-000000000000`)
    .lte("id", `${p}-ffff-ffff-ffff-ffffffffffff`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw dbError(`reply_drafts prefix lookup failed: ${error.message}`);
  const row = (data as DraftRow[] | null)?.[0];
  return row ? toReplyDraft(row) : null;
}

/**
 * Atomic approve / re-send claim. Exactly ONE caller wins:
 *   UPDATE reply_drafts SET status='approved', approved_at=COALESCE(approved_at, now()), updated_at=now()
 *   WHERE id=$1 AND user_id=$2 AND status = ANY($from) RETURNING *
 * Returns null when 0 rows (already handled / wrong owner / wrong state).
 * supabase-js cannot express COALESCE, so approved_at is stamped only when claiming from 'draft' (first approval);
 * a re-send claim from failed / send_uncertain keeps the original approved_at (the reconcile window, PLAN.md §15).
 */
export async function claimDraftForSend(
  draftId: string,
  userId: string,
  from: ReplyDraftStatus[] = ["draft"],
): Promise<ReplyDraftRecord | null> {
  if (from.length === 0) return null;
  const now = new Date().toISOString();
  const patch: Partial<DraftRow> = { status: "approved", updated_at: now };
  if (from.includes("draft")) patch.approved_at = now;
  const { data, error } = await supabase
    .from("reply_drafts")
    .update(patch)
    .eq("id", draftId)
    .eq("user_id", userId)
    .in("status", from)
    .select("*");
  if (error) throw dbError(`reply_drafts claim failed: ${error.message}`);
  const won = ((data as DraftRow[] | null) ?? [])[0];
  return won ? toReplyDraft(won) : null;
}

export async function markDraft(
  draftId: string,
  patch: { status: ReplyDraftStatus; sentExternalMessageId?: string | null; errorDetail?: string | null },
): Promise<ReplyDraftRecord> {
  const update: Partial<DraftRow> = { status: patch.status, updated_at: new Date().toISOString() };
  if (patch.sentExternalMessageId !== undefined) update.sent_external_message_id = patch.sentExternalMessageId;
  if (patch.errorDetail !== undefined) update.error_detail = patch.errorDetail;
  const { data, error } = await supabase.from("reply_drafts").update(update).eq("id", draftId).select("*").single();
  if (error) throw dbError(`reply_drafts mark failed: ${error.message}`);
  return toReplyDraft(data as DraftRow);
}

/** draft → cancelled (only from 'draft'). Returns false when nothing changed. */
export async function cancelDraft(draftId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("reply_drafts")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("user_id", userId)
    .eq("status", "draft")
    .select("id");
  if (error) throw dbError(`reply_drafts cancel failed: ${error.message}`);
  return ((data as { id: string }[] | null) ?? []).length > 0;
}

export async function listDraftsForMessage(messageId: string, userId: string): Promise<ReplyDraftRecord[]> {
  const { data, error } = await supabase
    .from("reply_drafts")
    .select("*")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw dbError(`reply_drafts list failed: ${error.message}`);
  return ((data as DraftRow[] | null) ?? []).map(toReplyDraft);
}
