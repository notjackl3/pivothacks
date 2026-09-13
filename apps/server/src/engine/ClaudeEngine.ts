import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MessageInterpretationSchema, ReplyDraftOutputSchema, type AnalysisContext, type ComprehensionEngine, type ConversationContext, type MessageInterpretation, type NormalizedMessage, type ReplyDraftOutput, type ReplyTone, type UserPreferences } from "@reelrelay/shared";
import { config, requireConfig } from "../config.js";
import { checkFaithfulness } from "./faithfulness.js";
import { interpretationInput, interpretationSystem, replyInput, replySystem } from "./prompts.js";

export type ParseRequest = {
  kind: "interpretation" | "reply";
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  effort: "medium" | "low";
  targetLanguage?: string;
};
export type ParseResult = { output: unknown; stopReason: string | null };
export type StructuredTransport = (request: ParseRequest) => Promise<ParseResult>;
export class EngineError extends Error {
  constructor(public readonly code: "LLM_INVALID" | "LLM_REFUSED" | "LLM_UNAVAILABLE", message: string) { super(message); this.name = "EngineError"; }
}

export class ClaudeEngine implements ComprehensionEngine {
  private client?: Anthropic;
  private effort: "medium" | "low";
  private recentLatencies: number[] = [];
  constructor(private readonly options: { transport?: StructuredTransport; effort?: "medium" | "low"; now?: () => Date } = {}) {
    this.effort = options.effort ?? config.ANTHROPIC_EFFORT;
  }
  private async parse(request: ParseRequest): Promise<ParseResult> {
    if (this.options.transport) return this.options.transport(request);
    this.client ??= new Anthropic({ apiKey: requireConfig("ANTHROPIC_API_KEY"), maxRetries: 1, timeout: 45000 });
    const base = { model: config.ANTHROPIC_MODEL, system: request.system, messages: request.messages };
    try {
      if (request.kind === "interpretation") {
        const result = await this.client.messages.parse({ ...base, max_tokens: 8192, output_config: { effort: request.effort, format: zodOutputFormat(MessageInterpretationSchema) } });
        return { output: result.parsed_output, stopReason: result.stop_reason };
      }
      const result = await this.client.messages.parse({ ...base, max_tokens: 2048, output_config: { effort: "low", format: zodOutputFormat(ReplyDraftOutputSchema) } });
      return { output: result.parsed_output, stopReason: result.stop_reason };
    } catch (error) {
      // SDK-side parsing failures also use the application's one corrective retry.
      if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) return { output: null, stopReason: null };
      throw error;
    }
  }
  async analyze(message: NormalizedMessage, prefs: UserPreferences, context?: AnalysisContext): Promise<MessageInterpretation> {
    return this.analyzeWithInstruction(message, prefs, undefined, context);
  }
  async analyzeWithInstruction(message: NormalizedMessage, prefs: UserPreferences, extra?: string, context?: AnalysisContext): Promise<MessageInterpretation> {
    const started = performance.now();
    const request: ParseRequest = { kind: "interpretation", targetLanguage: prefs.targetLanguage, system: interpretationSystem(message, prefs, this.options.now?.(), context), effort: this.effort, messages: [{ role: "user", content: interpretationInput(message, extra, prefs.targetLanguage) }] };
    let refusal = false;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.parse(request);
        refusal = result.stopReason === "refusal";
        const parsed = MessageInterpretationSchema.safeParse(result.output);
        const issues = refusal ? ["The provider could not interpret this message."] : !parsed.success ? parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) : checkFaithfulness(message.text, parsed.data).map((issue) => `${issue.check}${issue.actionIndex === undefined ? "" : ` action ${issue.actionIndex + 1}`}: ${issue.message}`);
        if (parsed.success && !refusal) {
          if (parsed.data.targetLanguage !== prefs.targetLanguage) issues.push(`targetLanguage must be exactly ${prefs.targetLanguage}; write the translation, narration and actions in that language.`);
          if (!/^en(?:-|$)/i.test(prefs.targetLanguage) && parsed.data.captionTranslation?.language !== "en") issues.push("Include captionTranslation with language=en and one English translation for every narration segment.");
        }
        if (!refusal && parsed.success && issues.length === 0 && result.stopReason !== "max_tokens") return parsed.data;
        request.messages.push({ role: "assistant", content: JSON.stringify(result.output ?? {}) }, { role: "user", content: `Your previous output failed these checks:\n${issues.join("\n")}\nReturn a complete corrected object only. Do not change source facts.` });
      }
      throw new EngineError(refusal ? "LLM_REFUSED" : "LLM_INVALID", "Translation unavailable. Review the original message and try again.");
    } finally {
      this.recentLatencies = [...this.recentLatencies.slice(-2), performance.now() - started];
      if (this.recentLatencies.length === 3 && this.recentLatencies.every((ms) => ms > 12000)) this.effort = "low";
    }
  }
  async draftReply(ctx: ConversationContext, userInput: string, tone: ReplyTone): Promise<ReplyDraftOutput> {
    if (!userInput.trim() || userInput.length > 8000) throw new EngineError("LLM_INVALID", "Reply text must contain between 1 and 8,000 characters.");
    const request: ParseRequest = { kind: "reply", system: replySystem(ctx, tone), effort: "low", messages: [{ role: "user", content: replyInput(ctx, userInput) }] };
    let refusal = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.parse(request);
      refusal = result.stopReason === "refusal";
      const parsed = ReplyDraftOutputSchema.safeParse(result.output);
      if (!refusal && parsed.success && result.stopReason !== "max_tokens") return parsed.data;
      request.messages.push({ role: "assistant", content: JSON.stringify(result.output ?? {}) }, { role: "user", content: "Return a complete schema-valid draft that translates only the student's input. Preserve all facts and conditions." });
    }
    throw new EngineError(refusal ? "LLM_REFUSED" : "LLM_INVALID", "A reply could not be drafted. Your message has not been sent.");
  }
}
