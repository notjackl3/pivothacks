import { describe, expect, it } from "vitest";
import { filterSlackEnvelope, pickAuthedUserId, type SlackEventEnvelope } from "../src/connectors/slack/filter.js";

function envelope(eventOverrides: Record<string, unknown> = {}, envelopeOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token: "PLACEHOLDER_VERIFICATION_TOKEN",
    team_id: "T0000EXAMPLE",
    api_app_id: "A0000EXAMPLE",
    type: "event_callback",
    event_id: "Ev0000EXAMPLE1",
    event_time: 1757772131,
    authorizations: [{ enterprise_id: null, team_id: "T0000EXAMPLE", user_id: "U0000STUDENT", is_bot: false, is_enterprise_install: false }],
    event: {
      type: "message",
      channel: "D0000EXAMPLE",
      channel_type: "im",
      user: "U0000PROFESSOR",
      text: "Hi Jack — the deadline moved to Friday at 5:00 PM.",
      ts: "1757772131.000200",
      event_ts: "1757772131.000200",
      client_msg_id: "00000000-0000-0000-0000-000000000000",
      ...eventOverrides,
    },
    ...envelopeOverrides,
  };
}

describe("filterSlackEnvelope", () => {
  it("accepts a plain human DM and reports team, authed user, and channel type", () => {
    const result = filterSlackEnvelope(envelope());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.teamId).toBe("T0000EXAMPLE");
    expect(result.authedUserId).toBe("U0000STUDENT");
    expect(result.channelType).toBe("im");
    expect(result.event.user).toBe("U0000PROFESSOR");
    expect(result.event.channel).toBe("D0000EXAMPLE");
    expect(result.event.ts).toBe("1757772131.000200");
    expect(result.event.text).toContain("Friday at 5:00 PM");
  });

  it("rejects bot messages (bot_id)", () => {
    expect(filterSlackEnvelope(envelope({ bot_id: "B0000BOT" }))).toEqual({ ok: false, reason: "bot_message" });
  });

  it("rejects any subtype (edits, deletes, joins, …)", () => {
    for (const subtype of ["message_changed", "message_deleted", "channel_join", "file_share"]) {
      const result = filterSlackEnvelope(envelope({ subtype }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(`subtype:${subtype}`);
    }
  });

  it("rejects missing, empty, or whitespace-only text", () => {
    expect(filterSlackEnvelope(envelope({ text: undefined }))).toEqual({ ok: false, reason: "empty_text" });
    expect(filterSlackEnvelope(envelope({ text: "" }))).toEqual({ ok: false, reason: "empty_text" });
    expect(filterSlackEnvelope(envelope({ text: "   \n\t" }))).toEqual({ ok: false, reason: "empty_text" });
    expect(filterSlackEnvelope(envelope({ text: 42 }))).toEqual({ ok: false, reason: "empty_text" });
  });

  it("rejects events without a user id", () => {
    expect(filterSlackEnvelope(envelope({ user: undefined }))).toEqual({ ok: false, reason: "missing_user" });
  });

  it("rejects url_verification and other envelope types", () => {
    expect(filterSlackEnvelope({ type: "url_verification", challenge: "abc", token: "t" })).toEqual({ ok: false, reason: "url_verification" });
    const other = filterSlackEnvelope({ type: "app_rate_limited", team_id: "T1" });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toMatch(/^unsupported_type:/);
  });

  it("rejects non-message events", () => {
    const result = filterSlackEnvelope(envelope({ type: "reaction_added" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^unsupported_event_type:/);
  });

  it("rejects channel_type 'channel' / 'group' / 'mpim' by default (user-token mode reels DMs only)", () => {
    for (const channel_type of ["channel", "group", "mpim"]) {
      const result = filterSlackEnvelope(envelope({ channel_type, channel: "C0000CLASS" }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(`channel_type:${channel_type}`);
    }
    expect(filterSlackEnvelope(envelope({ channel_type: undefined }))).toEqual({ ok: false, reason: "channel_type:undefined" });
  });

  it("accepts 'channel' and 'group' with allowChannels (bot mode) and reports channelType 'channel'", () => {
    for (const channel_type of ["channel", "group"]) {
      const result = filterSlackEnvelope(envelope({ channel_type, channel: "C0000CLASS" }), { allowChannels: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.channelType).toBe("channel");
        expect(result.event.channel).toBe("C0000CLASS");
      }
    }
    const mpim = filterSlackEnvelope(envelope({ channel_type: "mpim" }), { allowChannels: true });
    expect(mpim.ok).toBe(false);
    const im = filterSlackEnvelope(envelope(), { allowChannels: true });
    expect(im.ok && im.channelType).toBe("im");
  });

  it("falls back to authorizations[0].team_id when team_id is absent", () => {
    const result = filterSlackEnvelope(envelope({}, { team_id: undefined }));
    expect(result.ok && result.teamId).toBe("T0000EXAMPLE");
    expect(filterSlackEnvelope(envelope({}, { team_id: undefined, authorizations: [] }))).toEqual({ ok: false, reason: "missing_team_id" });
  });

  it("never throws on garbage input", () => {
    const garbage: unknown[] = [null, undefined, 42, "string", [], {}, { type: "event_callback" }, { type: "event_callback", event: null }, { type: "event_callback", event: "x" }, { type: "event_callback", event: { type: "message" } }, { type: "event_callback", event: { type: "message", user: 1, text: 2, channel: 3, ts: 4 } }, { type: "event_callback", authorizations: "nope", event: { type: "message", user: "U1", text: "t", channel: "D1", ts: "1.2", channel_type: "im" } }];
    for (const input of garbage) {
      let result: ReturnType<typeof filterSlackEnvelope> | undefined;
      expect(() => {
        result = filterSlackEnvelope(input, { allowChannels: true });
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
  });
});

describe("pickAuthedUserId", () => {
  it("returns authorizations[0].user_id for a human authorization", () => {
    expect(pickAuthedUserId(envelope() as unknown as SlackEventEnvelope)).toBe("U0000STUDENT");
  });

  it("returns null for a bot authorization, missing list, or missing user id", () => {
    expect(pickAuthedUserId(envelope({}, { authorizations: [{ team_id: "T1", user_id: "U0000BOT", is_bot: true }] }) as unknown as SlackEventEnvelope)).toBeNull();
    expect(pickAuthedUserId(envelope({}, { authorizations: undefined }) as unknown as SlackEventEnvelope)).toBeNull();
    expect(pickAuthedUserId(envelope({}, { authorizations: [] }) as unknown as SlackEventEnvelope)).toBeNull();
    expect(pickAuthedUserId(envelope({}, { authorizations: [{ team_id: "T1" }] }) as unknown as SlackEventEnvelope)).toBeNull();
    expect(pickAuthedUserId({ type: "event_callback", authorizations: [null as unknown as { user_id: string }] })).toBeNull();
  });
});
