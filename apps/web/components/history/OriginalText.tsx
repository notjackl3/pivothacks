"use client";

import type { MessageDetailResponse } from "@reelrelay/shared";
import { formatAbsoluteTime, slackThreadTs } from "@/lib/format";
import { messageSourceLabel } from "@/lib/status";
import { Card, KeyValue, MockBadge } from "@/components/ui";

export interface OriginalTextProps {
  message: MessageDetailResponse["message"];
  index?: number;
}

/** The sender's message, byte-for-byte, with its Slack coordinates. */
export function OriginalText({ message, index = 0 }: OriginalTextProps) {
  const threadTs = slackThreadTs(message);

  return (
    <Card eyebrow="Original" title="Exactly as received" action={message.isMock ? <MockBadge size="md" /> : undefined} index={index}>
      <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-muted px-4 py-3 font-sans text-[15px] leading-7 text-ink">
        {message.originalText}
      </pre>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KeyValue label="From">
          {message.senderDisplayName}
          <span className="ml-1 font-mono text-xs text-ink-faint">· {message.senderExternalId}</span>
        </KeyValue>
        <KeyValue label="Received">{formatAbsoluteTime(message.receivedAt)}</KeyValue>
        <KeyValue label="Channel" mono>
          {message.externalChannelId}
        </KeyValue>
        <KeyValue label="Source">
          {messageSourceLabel(message.source, message.externalChannelId)}
          {threadTs && <span className="ml-1 font-mono text-xs text-ink-faint">· ts {threadTs}</span>}
        </KeyValue>
      </dl>
    </Card>
  );
}
