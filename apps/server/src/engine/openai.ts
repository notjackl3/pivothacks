import { z } from "zod";
import { MessageInterpretationSchema, ReplyDraftOutputSchema } from "@reelrelay/shared";
import { config, requireConfig } from "../config.js";
import { EngineError, type ParseRequest, type StructuredTransport } from "./ClaudeEngine.js";

// OpenAI strict schemas require every property. Null represents the optional
// secondary caption track on the wire; the application's schema stays unchanged.
const WireInterpretationSchema = MessageInterpretationSchema.extend({
  captionTranslation: MessageInterpretationSchema.shape.captionTranslation.unwrap().nullable(),
});
function outputSchema(request: ParseRequest) {
  if (request.kind === "reply") return z.toJSONSchema(ReplyDraftOutputSchema);
  if (!request.targetLanguage) return z.toJSONSchema(WireInterpretationSchema);
  const captions = MessageInterpretationSchema.shape.captionTranslation.unwrap().extend({ language: z.enum(["en"]) })
    .describe("English subtitles: translate the hook and each narration segment into English, preserving order and facts.");
  return z.toJSONSchema(WireInterpretationSchema.extend({
    targetLanguage: z.enum([request.targetLanguage]),
    captionTranslation: /^en(?:-|$)/i.test(request.targetLanguage) ? captions.nullable() : captions,
  }));
}
const ResponseSchema = z.object({
  status: z.string(),
  incomplete_details: z.object({ reason: z.string() }).nullable().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).default([]),
});

/** Uses the same corrective retry and faithfulness checks as the Claude adapter. */
export function createOpenAITransport(options: { apiKey?: string; model?: string; fetch?: typeof fetch } = {}): StructuredTransport {
  return async (request) => {
    const model = options.model ?? config.OPENAI_MODEL;
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey ?? requireConfig("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, store: false, instructions: request.system, input: request.messages,
          max_output_tokens: request.kind === "interpretation" ? 8192 : 2048,
          ...(/^gpt-[56](?:[.-]|$)|^o\d/.test(model) ? { reasoning: { effort: request.effort } } : {}),
          text: { format: { type: "json_schema", name: request.kind, schema: outputSchema(request), strict: true } },
        }),
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new EngineError("LLM_UNAVAILABLE", "OpenAI could not be reached. Check OPENAI_API_KEY and the network, then retry.");
    }
    if (!response.ok) throw new EngineError("LLM_UNAVAILABLE", `OpenAI request failed (HTTP ${response.status}). Check the API key, model access and quota.`);
    const parsed = ResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new EngineError("LLM_UNAVAILABLE", "OpenAI returned an unexpected response.");
    const result = parsed.data;
    const content = result.output.filter((item) => item.type === "message").flatMap((item) => item.content ?? []);
    if (content.some((item) => item.type === "refusal")) return { output: null, stopReason: "refusal" };
    if (result.status === "incomplete") return { output: null, stopReason: result.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : "refusal" };
    if (result.status !== "completed") throw new EngineError("LLM_UNAVAILABLE", "OpenAI did not complete the response.");
    try {
      const text = content.filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("");
      const output = JSON.parse(text) as unknown;
      if (request.kind === "interpretation" && output && typeof output === "object" && "captionTranslation" in output && output.captionTranslation === null) {
        delete output.captionTranslation;
      }
      return { output, stopReason: "end_turn" };
    } catch { return { output: null, stopReason: null }; }
  };
}
