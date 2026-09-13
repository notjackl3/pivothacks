import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { MessageInterpretationSchema, UserPreferencesSchema, type NormalizedMessage } from "../packages/shared/src/index.js";
import { languageSamples, languageSource, sampleInterpretation } from "../fixtures/languages/samples.js";
import { checkFaithfulness } from "../apps/server/src/engine/faithfulness.js";
import { getEngine, selectedEngineProvider } from "../apps/server/src/engine/index.js";
import { config, repoRoot } from "../apps/server/src/config.js";
import { synthesizeSpeech, audioDurationMs, speechModelForLanguage, type SpeechResult } from "../apps/server/src/tts/elevenlabs.js";
import { captionsOnlyTiming, withTiming } from "../apps/server/src/tts/timing.js";
import { RemotionRenderer } from "../apps/server/src/render/RemotionRenderer.js";

const runFile = promisify(execFile);
const { values } = parseArgs({ options: { live: { type: "boolean" }, silent: { type: "boolean" }, "text-only": { type: "boolean" }, language: { type: "string" }, "reuse-audio": { type: "boolean" } } });
const selected = languageSamples.filter((sample) => !values.language || sample.id === values.language);
if (!selected.length) throw new Error("Choose zh-CN, vi, ko, es or fr.");
if (!values.silent && !values["text-only"] && !config.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is required for real audio checks.");
const provider = selectedEngineProvider();
if (values.live && (config.ENGINE_MODE !== "live" || !(provider === "openai" ? config.OPENAI_API_KEY : config.ANTHROPIC_API_KEY))) {
  throw new Error("Live language checks require ENGINE_MODE=live and a key for the selected provider.");
}
const directory = path.join(repoRoot, "build/language-check", `${values.live ? "live" : "authored"}${values.silent ? "-silent" : ""}`);
await mkdir(directory, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const sample of selected) {
  const started = performance.now();
  const messageId = randomUUID();
  const message: NormalizedMessage = { provider: "mock", connectionId: randomUUID(), externalMessageId: `language-check:${messageId}`, externalChannelId: "DEMO", externalThreadId: null, senderExternalId: "DEMO_PROFESSOR", senderDisplayName: "Demo Professor", text: languageSource, receivedAt: new Date().toISOString() };
  const preferences = UserPreferencesSchema.parse({ targetLanguage: sample.id });
  const prefix = path.join(directory, sample.id);
  let stage = "interpretation";
  try {
    console.info(`[${sample.id}] ${values.live ? provider : "authored fixture"}: checking interpretation`);
    const inputPath = `${prefix}.input.json`;
    const cached = values["reuse-audio"] ? await readFile(inputPath, "utf8").then(JSON.parse).catch(() => null) as { originalText?: string; interpretation?: unknown } | null : null;
    const interpretation = cached?.originalText === languageSource ? MessageInterpretationSchema.parse(cached.interpretation)
      : values.live ? await getEngine().analyze(message, preferences) : sampleInterpretation(sample);
    await writeFile(`${prefix}.observed.json`, JSON.stringify(interpretation, null, 2));
    if (interpretation.targetLanguage !== sample.id) throw new Error("The engine returned the wrong target language.");
    const issues = checkFaithfulness(languageSource, interpretation);
    if (issues.length) throw new Error(JSON.stringify(issues));
    if (interpretation.captionTranslation?.language !== "en") throw new Error("English captions were not generated.");
    await writeFile(inputPath, JSON.stringify({ originalText: languageSource, senderDisplayName: message.senderDisplayName, interpretation }, null, 2));
    if (values.live) {
      stage = "reply";
      const reply = await getEngine().draftReply({ message, interpretation, preferences }, sample.reply, "respectful_student");
      await writeFile(`${prefix}.reply.json`, JSON.stringify(reply, null, 2));
    }
    if (values["text-only"]) {
      const result = { language: sample.id, label: sample.label, status: "text_passed", interpretation: values.live ? provider : "authored fixture", liveReply: Boolean(values.live), narrationChecked: false, elapsedSeconds: Math.round((performance.now() - started) / 1000) };
      results.push(result);
      await writeFile(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
      console.info(JSON.stringify(result));
      continue;
    }
    stage = "speech";
    console.info(`[${sample.id}] ${values.silent ? "caption-only preview; audio NOT checked" : `${speechModelForLanguage(sample.id)}: generating narration`}`);
    let speech: SpeechResult;
    const savedSpeech = values["reuse-audio"] && cached ? await readFile(`${prefix}.speech.json`, "utf8").then(JSON.parse).catch(() => null) as SpeechResult | null : null;
    if (values.silent) speech = { ...captionsOnlyTiming(interpretation.spokenSegments), mode: "captions_only", audioPath: null };
    else if (savedSpeech?.audioPath && savedSpeech.mode === "voiced" && Math.abs(await audioDurationMs(savedSpeech.audioPath) - savedSpeech.narrationMs) < 250) speech = savedSpeech;
    else speech = await synthesizeSpeech(interpretation, messageId);
    if (!values.silent && (speech.mode !== "voiced" || !speech.audioPath)) throw new Error(speech.reason ?? "No narration audio returned.");
    await writeFile(`${prefix}.speech.json`, JSON.stringify(speech, null, 2));
    const timed = withTiming(interpretation, speech);
    if (timed.captionSegments.some((segment) => !segment.translation)) throw new Error("A timed caption is missing its English translation.");
    stage = "render";
    let milestone = -1;
    const renderer = new RemotionRenderer({ messageId, audioPath: speech.audioPath, senderDisplayName: message.senderDisplayName, source: "mock", isMock: true, originalText: languageSource }, {
      background: "minecraft-parkour",
      onProgress(progress) { const next = Math.floor(progress * 4) * 25; if (next > milestone) { milestone = next; console.info(`[${sample.id}] export ${next}%`); } },
    });
    const artifact = await renderer.render(timed, preferences);
    if (!artifact.videoPath) throw new Error("The renderer did not produce a video.");
    const videoPath = `${prefix}.mp4`;
    await copyFile(artifact.videoPath, videoPath);
    await writeFile(`${prefix}.artifact.json`, JSON.stringify({ ...artifact, videoPath }, null, 2));
    stage = "media";
    const { stdout } = await runFile("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration,size", "-of", "json", videoPath], { windowsHide: true });
    const media = JSON.parse(stdout) as { streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }>; format: { duration: string; size: string } };
    if ((!values.silent && !media.streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac")) || !media.streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264")) throw new Error("Expected H.264 video and AAC narration.");
    if (Math.abs(Number(media.format.duration) * 1000 - timed.totalMs) > 300) throw new Error("Exported duration does not match the caption timeline.");
    let peakDb: number | null = null;
    if (!values.silent) {
      const { stderr } = await runFile("ffmpeg", ["-hide_banner", "-i", videoPath, "-af", "volumedetect", "-vn", "-f", "null", "-"], { windowsHide: true });
      const peak = /max_volume: (-?[\d.]+) dB/.exec(stderr);
      if (!peak || Number(peak[1]) < -35) throw new Error("Narration is silent or too quiet.");
      peakDb = Number(peak[1]);
    }
    const frameTimes = [Math.min(1, timed.narrationMs / 2000), Math.max(0.5, timed.narrationMs / 1000 - 1.5), timed.narrationMs / 1000 + 1];
    for (const [index, seconds] of frameTimes.entries()) await runFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(seconds), "-i", videoPath, "-frames:v", "1", "-vf", "scale=360:640", `${prefix}.frame-${index + 1}.jpg`], { windowsHide: true });
    const result = { language: sample.id, label: sample.label, status: values.silent ? "captions_only_passed" : "passed", interpretation: values.live ? provider : "authored fixture", liveReply: Boolean(values.live), narrationChecked: !values.silent, speechModel: speechModelForLanguage(sample.id), durationSeconds: Number(media.format.duration), bytes: Number(media.format.size), peakDb, captions: timed.captionSegments.length, videoPath, elapsedSeconds: Math.round((performance.now() - started) / 1000) };
    results.push(result);
    console.info(JSON.stringify(result));
  } catch (error) {
    const result = { language: sample.id, status: "failed", stage, error: error instanceof Error ? error.message : String(error) };
    results.push(result);
    console.error(JSON.stringify(result));
    process.exitCode = 1;
    if (/HTTP[_ ](?:401|403)/.test(result.error)) {
      await writeFile(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
      console.error("Stopped: provider authentication must be corrected before any language can proceed.");
      break;
    }
  }
  await writeFile(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
}
