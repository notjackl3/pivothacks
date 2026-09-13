import { describe, expect, it, vi } from "vitest";
import { languageSamples, languageSource, sampleInterpretation } from "../../../fixtures/languages/samples.js";
import { checkFaithfulness, containsTime } from "../src/engine/faithfulness.js";
import { createOpenAITransport } from "../src/engine/openai.js";
import { ClaudeEngine, type StructuredTransport } from "../src/engine/ClaudeEngine.js";
import { UserPreferencesSchema, type NormalizedMessage } from "@reelrelay/shared";
import { spokenText } from "../src/tts/timing.js";
import { speechModelForLanguage } from "../src/tts/elevenlabs.js";

const positiveUpload: Record<string, string> = {
  "zh-CN": "上传 ZIP 文件。", vi: "Tải lên tệp ZIP.", ko: "ZIP 파일을 업로드하세요.", es: "Sube el archivo ZIP.", fr: "Téléversez le fichier ZIP.",
};

describe("languages exposed in setup", () => {
  it.each(languageSamples)("accepts $label deadlines and prohibitions", (sample) => {
    expect(checkFaithfulness(languageSource, sampleInterpretation(sample))).toEqual([]);
  });
  it.each(languageSamples)("rejects a reversed $label prohibition", (sample) => {
    const interpretation = sampleInterpretation(sample);
    interpretation.actionItems[1]!.text = positiveUpload[sample.id]!;
    interpretation.spokenSegments[2] = positiveUpload[sample.id]!;
    expect(checkFaithfulness(languageSource, interpretation)).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: "A2", actionIndex: 1, message: "Preserve the negation in both the action text and narration." }),
    ]));
  });
  it.each(languageSamples)("rejects a missing $label deadline even with preserved facts", (sample) => {
    const interpretation = sampleInterpretation(sample);
    const deadlineIndex = sample.id === "zh-CN" || sample.id === "ko" ? 0 : 1;
    interpretation.spokenSegments.splice(deadlineIndex, 1);
    interpretation.captionTranslation!.spokenSegments.splice(deadlineIndex, 1);
    expect(checkFaithfulness(languageSource, interpretation)).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: "A2", actionIndex: 0, message: "Narration must include this item's deadline: Friday at 5:00 PM" }),
    ]));
  });
  it.each([
    ["ko", "오후 5시", true], ["ko", "오전 5시", false],
    ["vi", "5 giờ chiều", true], ["vi", "5 giờ sáng", false],
    ["fr", "17 h", true], ["fr", "5 h du matin", false],
    ["es", "5:00 de la tarde", true], ["es", "5:00 de la mañana", false],
  ] as const)("checks %s numeric clock notation: %s", (language, text, expected) => {
    expect(containsTime(text, "5:00 PM", language)).toBe(expected);
  });
  it("preserves spaces between Korean narration chunks", () => {
    const sample = languageSamples.find((language) => language.id === "ko")!;
    expect(spokenText(sampleInterpretation(sample))).toContain("5:00까지 PDF");
  });
  it("routes Vietnamese away from unsupported Multilingual v2 without overriding another configured model", () => {
    expect(speechModelForLanguage("vi", "eleven_multilingual_v2")).toBe("eleven_flash_v2_5");
    expect(speechModelForLanguage("vi-VN", "eleven_multilingual_v2")).toBe("eleven_flash_v2_5");
    expect(speechModelForLanguage("zh-CN", "eleven_multilingual_v2")).toBe("eleven_multilingual_v2");
    expect(speechModelForLanguage("vi", "eleven_v3")).toBe("eleven_v3");
  });
});

describe("OpenAI structured transport", () => {
  it("retries a wrong target language and a non-English secondary caption track", async () => {
    const wrong = sampleInterpretation(languageSamples[0]);
    wrong.captionTranslation!.language = "zh-CN";
    const correct = sampleInterpretation(languageSamples[1]);
    const transport = vi.fn<StructuredTransport>().mockResolvedValueOnce({ output: wrong, stopReason: "end_turn" }).mockResolvedValueOnce({ output: correct, stopReason: "end_turn" });
    const engine = new ClaudeEngine({ transport });
    const message: NormalizedMessage = { provider: "mock", connectionId: "00000000-0000-4000-8000-000000000001", externalMessageId: "test", externalChannelId: "test", externalThreadId: null, senderExternalId: "test", senderDisplayName: "Demo Professor", text: languageSource, receivedAt: "2026-09-13T14:00:00Z" };
    expect(await engine.analyze(message, UserPreferencesSchema.parse({ targetLanguage: "vi" }))).toEqual(correct);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]?.[0].targetLanguage).toBe("vi");
    expect(transport.mock.calls[1]?.[0].messages.at(-1)?.content).toContain("targetLanguage must be exactly vi");
    expect(transport.mock.calls[1]?.[0].messages.at(-1)?.content).toContain("language=en");
  });
  it("uses a strict schema and normalizes an absent secondary caption track", async () => {
    const wire = { ...sampleInterpretation(languageSamples[0]), captionTranslation: null };
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(wire) }] }] }), { status: 200 }));
    const transport = createOpenAITransport({ apiKey: "test-key", model: "gpt-5-mini", fetch: request });
    const result = await transport({ kind: "interpretation", system: "Translate only.", messages: [{ role: "user", content: "Synthetic sample" }], effort: "low" });
    const payload = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as { store: boolean; text: { format: { strict: boolean; schema: { required: string[] } } } };
    expect(payload.store).toBe(false);
    expect(payload.text.format.strict).toBe(true);
    expect(payload.text.format.schema.required).toContain("captionTranslation");
    expect(result.stopReason).toBe("end_turn");
    expect(result.output).not.toHaveProperty("captionTranslation");
  });
  it("keeps refusals and truncated responses out of the translation pipeline", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Declined" }] }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] })));
    const transport = createOpenAITransport({ apiKey: "test-key", fetch: request });
    const input = { kind: "interpretation" as const, system: "Translate only.", messages: [], effort: "low" as const };
    expect(await transport(input)).toEqual({ output: null, stopReason: "refusal" });
    expect(await transport(input)).toEqual({ output: null, stopReason: "max_tokens" });
  });
});
