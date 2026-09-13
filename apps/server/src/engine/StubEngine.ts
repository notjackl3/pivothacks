import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { MessageInterpretationSchema, type ComprehensionEngine, type ConversationContext, type NormalizedMessage, type ReplyDraftOutput, type ReplyTone, type UserPreferences } from "@reelrelay/shared";
import { repoRoot } from "../config.js";

/** Explicit development engine; it will not translate arbitrary live messages. */
export class StubEngine implements ComprehensionEngine {
  async analyze(message: NormalizedMessage, prefs: UserPreferences) {
    if (prefs.targetLanguage !== "zh-CN") throw new Error("The fixture engine supports zh-CN only.");
    const directory = path.join(repoRoot, "fixtures/slack");
    for (const name of await readdir(directory)) {
      if (!name.endsWith(".json")) continue;
      const fixture = JSON.parse(await readFile(path.join(directory, name), "utf8")) as { event: { text: string } };
      if (fixture.event.text !== message.text) continue;
      return MessageInterpretationSchema.parse(JSON.parse(await readFile(path.join(repoRoot, "fixtures/expected", name.replace(".json", ".interpretation.json")), "utf8")));
    }
    throw new Error("No exact fixture matches this message. Configure ANTHROPIC_API_KEY and ENGINE_MODE=live.");
  }
  async draftReply(_ctx: ConversationContext, _input: string, _tone: ReplyTone): Promise<ReplyDraftOutput> {
    return {
      detectedInputLanguage: "zh-CN",
      draftEnglish: "Hi Professor Chen, could you please confirm which Wednesday you mean? Thank you, Jack",
      meaningCheck: "开发演示草稿：询问教授指的是哪一个星期三。此示例不是你的输入的翻译。",
      warnings: ["DEVELOPMENT FIXTURE: this canned reply does not translate your input."],
    };
  }
}
