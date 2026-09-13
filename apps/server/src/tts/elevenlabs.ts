import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import type { MessageInterpretation } from "@reelrelay/shared";
import { config, dataDir } from "../config.js";
import { alignedTiming, captionsOnlyTiming, spokenText } from "./timing.js";
import { defaultVoiceId } from "./voices.js";

const runFile = promisify(execFile);
const AlignmentSchema = z.object({ characters: z.array(z.string()), character_start_times_seconds: z.array(z.number()), character_end_times_seconds: z.array(z.number()) });
const SpeechSchema = z.object({ audio_base64: z.string().min(1), alignment: AlignmentSchema.nullable().optional() });
export type SpeechResult = ReturnType<typeof captionsOnlyTiming> & { audioPath: string | null; mode: "voiced" | "captions_only"; reason?: string };
export function speechModelForLanguage(language: string, configuredModel = config.ELEVENLABS_MODEL_ID): string {
  // Multilingual v2 has no Vietnamese support; Flash v2.5 includes Vietnamese.
  return /^vi(?:-|$)/i.test(language) && configuredModel === "eleven_multilingual_v2" ? "eleven_flash_v2_5" : configuredModel;
}
export async function audioDurationMs(file: string): Promise<number> {
  const { stdout } = await runFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { timeout: 10000, windowsHide: true });
  const duration = Number(stdout.trim()) * 1000;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Audio duration could not be measured.");
  return Math.ceil(duration);
}
export async function synthesizeSpeech(interp: MessageInterpretation, messageId: string, options: { fetch?: typeof fetch; apiKey?: string; voiceId?: string; outputDir?: string; probe?: typeof audioDurationMs } = {}): Promise<SpeechResult> {
  const apiKey = options.apiKey ?? config.ELEVENLABS_API_KEY;
  const fallback = (reason: string): SpeechResult => ({ ...captionsOnlyTiming(interp.spokenSegments), audioPath: null, mode: "captions_only", reason });
  if (!apiKey) return fallback("TTS_NOT_CONFIGURED");
  try {
    const voiceId = options.voiceId ?? config.ELEVENLABS_VOICE_ID ?? await defaultVoiceId(apiKey, options.fetch ?? fetch);
    const modelId = speechModelForLanguage(interp.targetLanguage);
    const response = await (options.fetch ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text: spokenText(interp), model_id: modelId, ...(modelId === "eleven_multilingual_v2" ? {} : { language_code: interp.targetLanguage.split(/[-_]/)[0]?.toLowerCase() }) }), signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) return fallback(`TTS_HTTP_${response.status}`);
    const body = SpeechSchema.parse(await response.json());
    if (!body.alignment) return fallback("TTS_ALIGNMENT_MISSING");
    const audio = Buffer.from(body.audio_base64, "base64");
    if (audio.length === 0 || audio.length > 10 * 1024 * 1024) return fallback("TTS_AUDIO_INVALID");
    const directory = options.outputDir ?? path.join(dataDir, "audio");
    await mkdir(directory, { recursive: true });
    const safeId = z.string().uuid().parse(messageId);
    const audioPath = path.join(directory, `${safeId}.mp3`);
    await writeFile(audioPath, audio);
    const actualMs = await (options.probe ?? audioDurationMs)(audioPath);
    return { ...alignedTiming(interp.spokenSegments, body.alignment, actualMs), audioPath, mode: "voiced" };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return fallback(code.startsWith("TTS_VOICE_") ? code : code === "ENOENT" ? "TTS_FFPROBE_MISSING" : "TTS_FAILED");
  }
}
