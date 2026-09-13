import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MessageInterpretationSchema, UserPreferencesSchema, type NormalizedMessage } from "@reelrelay/shared";
import { repoRoot } from "../src/config.js";
import { checkFaithfulness, containsTime } from "../src/engine/faithfulness.js";
import { ClaudeEngine, type StructuredTransport } from "../src/engine/ClaudeEngine.js";

const names = ["professor_deadline", "landlord_docs", "manager_steps", "ambiguous_date", "bilingual", "negation"];
function fixture(name = "professor_deadline") {
  const source = JSON.parse(readFileSync(path.join(repoRoot, `fixtures/slack/${name}.json`), "utf8")) as { event: { text: string } };
  const interpretation = MessageInterpretationSchema.parse(JSON.parse(readFileSync(path.join(repoRoot, `fixtures/expected/${name}.interpretation.json`), "utf8")));
  return { source: source.event.text, interpretation };
}
describe("Tier A faithfulness", () => {
  it.each(names)("accepts the hand-authored %s fixture", (name) => {
    const { source, interpretation } = fixture(name);
    expect(checkFaithfulness(source, interpretation)).toEqual([]);
  });
  it("rejects a deadline missing from narration even when preservedFacts contains it", () => {
    const { source, interpretation } = fixture();
    interpretation.spokenSegments = interpretation.spokenSegments.filter((text) => !text.includes("周三"));
    expect(checkFaithfulness(source, interpretation)).toEqual(expect.arrayContaining([expect.objectContaining({ check: "A2", actionIndex: 3 })]));
  });
  it("does not let one narrated prohibition stand in for a second prohibition", () => {
    const { source, interpretation } = fixture("negation");
    interpretation.spokenSegments = interpretation.spokenSegments.filter((text) => !text.includes("密码"));
    expect(checkFaithfulness(source, interpretation).some((issue) => issue.check === "A2" && issue.actionIndex === 2)).toBe(true);
  });
  it("rejects a missing prohibition even if another is present", () => {
    const { source, interpretation } = fixture("negation");
    interpretation.actionItems = interpretation.actionItems.filter((action) => !action.text.includes("密码"));
    expect(checkFaithfulness(source, interpretation).some((issue) => issue.check === "A3")).toBe(true);
  });
  it("rejects invented evidence", () => {
    const { source, interpretation } = fixture();
    interpretation.actionItems[0]!.evidenceQuote = "Submit the spreadsheet tomorrow.";
    expect(checkFaithfulness(source, interpretation).some((issue) => issue.check === "A1")).toBe(true);
  });
  it("accepts localized PM and 24-hour times without confusing AM and PM", () => {
    expect(containsTime("晚上11:59", "11:59 PM")).toBe(true);
    expect(containsTime("23:59", "11:59 PM")).toBe(true);
    expect(containsTime("上午11:59", "11:59 PM")).toBe(false);
    expect(containsTime("下午5:00", "5:00 PM")).toBe(true);
    expect(containsTime("上午5:00", "5:00 PM")).toBe(false);
  });
  it("catches a changed monetary amount", () => {
    const { source, interpretation } = fixture("landlord_docs");
    interpretation.faithfulTranslation = interpretation.faithfulTranslation.replace("$1,250", "$1,200");
    interpretation.preservedFacts = interpretation.preservedFacts.filter((fact) => fact.label !== "amount");
    expect(checkFaithfulness(source, interpretation).some((issue) => issue.check === "A4")).toBe(true);
  });
  it("requires evidence of the old deadline when there is only one dueText", () => {
    const { source, interpretation } = fixture();
    for (const action of interpretation.actionItems) action.dueText = null;
    interpretation.preservedFacts = interpretation.preservedFacts.filter((fact) => fact.label !== "old_deadline");
    expect(checkFaithfulness(source, interpretation).some((issue) => issue.check === "A5")).toBe(true);
  });
});
describe("Claude structured interpretation", () => {
  it("corrects an invalid first response with exactly one retry", async () => {
    const { source, interpretation } = fixture();
    const bad = structuredClone(interpretation);
    bad.actionItems[0]!.evidenceQuote = "Not in the message";
    const transport = vi.fn<StructuredTransport>().mockResolvedValueOnce({ output: bad, stopReason: "end_turn" }).mockResolvedValueOnce({ output: interpretation, stopReason: "end_turn" });
    const engine = new ClaudeEngine({ transport });
    const message: NormalizedMessage = { provider: "mock", connectionId: "00000000-0000-4000-8000-000000000001", externalMessageId: "D:1", externalChannelId: "D", externalThreadId: null, senderExternalId: "U", senderDisplayName: "Professor Chen", text: source, receivedAt: "2026-09-13T14:00:00Z" };
    expect(await engine.analyze(message, UserPreferencesSchema.parse({}))).toEqual(interpretation);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1]?.[0].messages.at(-1)?.content).toContain("A1");
  });
  it("does not turn two refusals into a fabricated translation", async () => {
    const transport = vi.fn<StructuredTransport>().mockResolvedValue({ output: null, stopReason: "refusal" });
    const engine = new ClaudeEngine({ transport });
    const { source } = fixture();
    const message: NormalizedMessage = { provider: "mock", connectionId: "00000000-0000-4000-8000-000000000001", externalMessageId: "D:1", externalChannelId: "D", externalThreadId: null, senderExternalId: "U", senderDisplayName: "Professor Chen", text: source, receivedAt: "2026-09-13T14:00:00Z" };
    await expect(engine.analyze(message, UserPreferencesSchema.parse({}))).rejects.toMatchObject({ code: "LLM_REFUSED" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
