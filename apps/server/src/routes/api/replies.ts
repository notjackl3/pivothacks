// Dev B. POST /api/replies/:id/approve, POST /api/replies/:id/regenerate, POST /api/replies/:id/retry-send (PLAN.md §9, §15).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ReplyToneSchema, type ApproveReplyResponse, type RegenerateReplyResponse, type RetrySendReplyResponse } from "@reelrelay/shared";
import { requireUser } from "../../auth/requireUser.js";
import { parentTs } from "../../connectors/slack/normalize.js";
import { getReplyFlow, type ApproveOutcome } from "../../delivery/telegram/reply.js";
import { ApiError } from "./index.js";

const ParamsSchema = z.object({ id: z.string().uuid() });
const RegenerateBodySchema = z.object({ tone: ReplyToneSchema.optional() }).strict();

function parseParams(params: unknown): { id: string } {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) throw new ApiError(404, "not_found", "Draft not found");
  return parsed.data;
}

/** PLAN.md §9 approve response shape; `channel` / `threadTs` come from the message the draft answers. */
export function toApproveResponse(outcome: Extract<ApproveOutcome, { ok: true }>): ApproveReplyResponse {
  const { draft, message } = outcome;
  return {
    draft: {
      id: draft.id,
      status: draft.status,
      approvedAt: draft.approvedAt ?? null,
      sentExternalMessageId: draft.sentExternalMessageId ?? null,
      channel: message.externalChannelId,
      threadTs: parentTs(message.externalMessageId, message.externalThreadId),
      errorDetail: draft.errorDetail ?? null,
    },
  };
}

export async function registerRepliesRoutes(api: FastifyInstance): Promise<void> {
  api.post("/api/replies/:id/approve", async (req): Promise<ApproveReplyResponse> => {
    const userId = await requireUser(req);
    const { id } = parseParams(req.params);
    const outcome = await getReplyFlow().approveAndSend(id, userId);
    if (!outcome.ok) {
      if (outcome.code === "not_found" || !outcome.draft) throw new ApiError(404, "not_found", "Draft not found");
      throw new ApiError(409, "already_handled", `Draft is already ${outcome.draft.status}`);
    }
    return toApproveResponse(outcome);
  });

  api.post("/api/replies/:id/regenerate", async (req): Promise<RegenerateReplyResponse> => {
    const userId = await requireUser(req);
    const { id } = parseParams(req.params);
    const body = RegenerateBodySchema.safeParse(req.body ?? {});
    if (!body.success) throw new ApiError(400, "bad_request", body.error.issues.map((i) => i.message).join("; "));
    const draft = await getReplyFlow().regenerate(id, userId, body.data.tone);
    if (!draft) throw new ApiError(404, "not_found", "Draft not found or cannot be regenerated");
    return { draft };
  });

  api.post("/api/replies/:id/retry-send", async (req): Promise<RetrySendReplyResponse> => {
    const userId = await requireUser(req);
    const { id } = parseParams(req.params);
    const outcome = await getReplyFlow().retrySend(id, userId);
    if (!outcome.ok) {
      if (outcome.code === "not_found" || !outcome.draft) throw new ApiError(404, "not_found", "Draft not found");
      throw new ApiError(409, "not_retryable", `Draft is ${outcome.draft.status}; only failed or send_uncertain drafts can be re-sent`);
    }
    return toApproveResponse(outcome);
  });
}
