import type { JobStatus, ReplyDraftStatus } from "./messages.js";

export type ApiError = { error: { code: string; message: string } };
export type MessageListItem = {
  id: string;
  sender: string;
  preview: string;
  urgency: "low" | "medium" | "high" | null;
  jobStatus: JobStatus;
  isMock: boolean;
  hasVideo: boolean;
  replyStatus: ReplyDraftStatus | null;
  receivedAt: string;
};
export type MessageListResponse = { items: MessageListItem[] };
export type DemoInjectResponse = { messageId: string; jobId: string; isMock: true };

// Dev B may append endpoint types here without changing the existing exports.
