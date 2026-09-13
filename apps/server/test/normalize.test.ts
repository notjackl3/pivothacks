import { describe, expect, it } from "vitest";
import { NormalizedMessageSchema } from "@reelrelay/shared";
import { externalMessageIdFor, normalizeSlackEvent, parentTs, slackTsToIso } from "../src/connectors/slack/normalize.js";

// PLAN.md §9 — fixtures/slack/professor_deadline.json, inlined.
const PROFESSOR_TEXT =
  "Hi Jack — because Monday is a university closure, the project deadline has moved from Monday at 11:59 PM to Friday at 5:00 PM. Submit the PDF to Quercus, but send your source-code repository link directly to me in Slack. Do not upload the repository archive to Quercus. Let me know by Wednesday if your group needs an extension.";

const PROFESSOR_ENVELOPE = {
  token: "PLACEHOLDER_VERIFICATION_TOKEN",
  team_id: "T0000EXAMPLE",
  api_app_id: "A0000EXAMPLE",
  type: "event_callback",
  event_id: "Ev0000EXAMPLE1",
  event_time: 1757772131,
  event_context: "1-message-T0000EXAMPLE-D0000EXAMPLE",
  authorizations: [{ enterprise_id: null, team_id: "T0000EXAMPLE", user_id: "U0000STUDENT", is_bot: false, is_enterprise_install: false }],
  event: {
    type: "message",
    channel: "D0000EXAMPLE",
    channel_type: "im",
    user: "U0000PROFESSOR",
    text: PROFESSOR_TEXT,
    ts: "1757772131.000200",
    event_ts: "1757772131.000200",
    client_msg_id: "00000000-0000-0000-0000-000000000000",
  },
};

const CTX = { connectionId: "3b6f1a2c-0000-4000-8000-000000000000", senderDisplayName: "Prof. Chen" };

describe("externalMessageIdFor / parentTs", () => {
  it("joins channel and ts with a colon", () => {
    expect(externalMessageIdFor("D0000EXAMPLE", "1757772131.000200")).toBe("D0000EXAMPLE:1757772131.000200");
  });

  it("parentTs returns the thread id when the message is inside a thread", () => {
    expect(parentTs("D0000EXAMPLE:1757772422.000300", "1757772131.000200")).toBe("1757772131.000200");
  });

  it("parentTs returns the message's own ts when it is not in a thread", () => {
    expect(parentTs("D0000EXAMPLE:1757772131.000200", null)).toBe("1757772131.000200");
    expect(parentTs("D0000EXAMPLE:1757772131.000200", "")).toBe("1757772131.000200");
  });
});

describe("slackTsToIso", () => {
  it("converts the fixture ts to ISO 8601", () => {
    expect(slackTsToIso("1757772131.000200")).toBe("2025-09-13T14:02:11.000Z");
  });

  it("keeps the millisecond part of the fraction", () => {
    expect(slackTsToIso("1757772131.500200")).toBe("2025-09-13T14:02:11.500Z");
    expect(slackTsToIso("1757772131.5")).toBe("2025-09-13T14:02:11.500Z");
    expect(slackTsToIso("1757772131.123999")).toBe("2025-09-13T14:02:11.123Z");
    expect(slackTsToIso("1757772131")).toBe("2025-09-13T14:02:11.000Z");
  });

  it("throws on non-ts input", () => {
    expect(() => slackTsToIso("abc")).toThrow(/invalid_slack_ts/);
    expect(() => slackTsToIso("")).toThrow(/invalid_slack_ts/);
  });
});

describe("normalizeSlackEvent", () => {
  it("maps the professor DM fixture to a NormalizedMessage", () => {
    const normalized = normalizeSlackEvent(PROFESSOR_ENVELOPE, CTX);
    expect(normalized).toEqual({
      provider: "slack",
      connectionId: CTX.connectionId,
      externalMessageId: "D0000EXAMPLE:1757772131.000200",
      externalChannelId: "D0000EXAMPLE",
      externalThreadId: null,
      senderExternalId: "U0000PROFESSOR",
      senderDisplayName: "Prof. Chen",
      text: PROFESSOR_TEXT,
      receivedAt: "2025-09-13T14:02:11.000Z",
    });
    expect(NormalizedMessageSchema.safeParse(normalized).success).toBe(true);
  });

  it("keeps the text byte-exact (no trimming)", () => {
    const withSpace = { ...PROFESSOR_ENVELOPE, event: { ...PROFESSOR_ENVELOPE.event, text: "  padded  " } };
    expect(normalizeSlackEvent(withSpace, CTX)?.text).toBe("  padded  ");
  });

  it("carries thread_ts as externalThreadId and parentTs threads under it", () => {
    const reply = { ...PROFESSOR_ENVELOPE, event: { ...PROFESSOR_ENVELOPE.event, ts: "1757772422.000300", thread_ts: "1757772131.000200" } };
    const normalized = normalizeSlackEvent(reply, CTX);
    expect(normalized?.externalMessageId).toBe("D0000EXAMPLE:1757772422.000300");
    expect(normalized?.externalThreadId).toBe("1757772131.000200");
    expect(parentTs(normalized!.externalMessageId, normalized!.externalThreadId)).toBe("1757772131.000200");
  });

  it("treats a thread parent (thread_ts === ts) as not inside a thread", () => {
    const parent = { ...PROFESSOR_ENVELOPE, event: { ...PROFESSOR_ENVELOPE.event, thread_ts: "1757772131.000200" } };
    const normalized = normalizeSlackEvent(parent, CTX);
    expect(normalized?.externalThreadId).toBeNull();
    expect(parentTs(normalized!.externalMessageId, normalized!.externalThreadId)).toBe("1757772131.000200");
  });

  it("accepts channel events (gating is the webhook's job)", () => {
    const channel = { ...PROFESSOR_ENVELOPE, event: { ...PROFESSOR_ENVELOPE.event, channel: "C0000CLASS", channel_type: "channel" } };
    expect(normalizeSlackEvent(channel, CTX)?.externalChannelId).toBe("C0000CLASS");
  });

  it("returns null for unusable payloads", () => {
    expect(normalizeSlackEvent({ type: "url_verification", challenge: "x" }, CTX)).toBeNull();
    expect(normalizeSlackEvent({ ...PROFESSOR_ENVELOPE, event: { ...PROFESSOR_ENVELOPE.event, bot_id: "B1" } }, CTX)).toBeNull();
    expect(normalizeSlackEvent({ ...PROFESSOR_ENVELOPE, event: { ...PROFESSOR_ENVELOPE.event, ts: "garbage" } }, CTX)).toBeNull();
    expect(normalizeSlackEvent(null, CTX)).toBeNull();
    expect(normalizeSlackEvent("nope", CTX)).toBeNull();
  });
});
