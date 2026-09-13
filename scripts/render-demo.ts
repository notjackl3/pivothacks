import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { MessageInterpretationSchema, UserPreferencesSchema } from "../packages/shared/src/index.js";
import { config, repoRoot } from "../apps/server/src/config.js";
import { fixtureNames, MockSourceConnector } from "../apps/server/src/connectors/mock/MockSourceConnector.js";
import { RemotionRenderer } from "../apps/server/src/render/RemotionRenderer.js";
import { synthesizeSpeech, type SpeechResult } from "../apps/server/src/tts/elevenlabs.js";
import { captionsOnlyTiming, withTiming } from "../apps/server/src/tts/timing.js";

async function main() {
  const args = process.argv.slice(process.argv[2] === "--" ? 3 : 2);
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { help: { type: "boolean" }, silent: { type: "boolean" }, input: { type: "string" }, output: { type: "string" } },
  });
  if (values.help) {
    console.info("pnpm reel:render [professor_deadline] [--silent] [--output build/demo/reel.mp4]\npnpm reel:render --input message.json\n\nCustom input: { originalText, senderDisplayName, interpretation: MessageInterpretation }.\nVoiced export requires ELEVENLABS_API_KEY in root .env. ELEVENLABS_VOICE_ID is optional.\n--silent explicitly exports a caption-only preview. No database or messaging accounts are required.");
    return;
  }
  if (!values.silent && !config.ELEVENLABS_API_KEY) {
    throw new Error("Add ELEVENLABS_API_KEY to the root .env for narration, or use --silent for a caption-only preview.");
  }
  const started = performance.now();
  let interpretation;
  let originalText: string;
  let senderDisplayName: string;
  let name: string;
  if (values.input) {
    const input = JSON.parse(await readFile(path.resolve(values.input), "utf8")) as Record<string, unknown>;
    if (typeof input.originalText !== "string" || !input.originalText.trim() || typeof input.senderDisplayName !== "string" || !input.senderDisplayName.trim()) {
      throw new Error("The input JSON needs originalText, senderDisplayName, and an interpretation object.");
    }
    interpretation = MessageInterpretationSchema.parse(input.interpretation);
    originalText = input.originalText;
    senderDisplayName = input.senderDisplayName;
    name = path.basename(values.input, path.extname(values.input));
  } else {
    const fixture = positionals[0] ?? "professor_deadline";
    if (positionals.length > 1 || !fixtureNames.includes(fixture as typeof fixtureNames[number])) {
      throw new Error(`Choose a fixture: ${fixtureNames.join(", ")}`);
    }
    const [interpretationJson, sourceJson, metadataJson] = await Promise.all([
      readFile(path.join(repoRoot, "fixtures/expected", `${fixture}.interpretation.json`), "utf8"),
      readFile(path.join(repoRoot, "fixtures/slack", `${fixture}.json`), "utf8"),
      readFile(path.join(repoRoot, "fixtures/expected", `${fixture}.json`), "utf8"),
    ]);
    interpretation = MessageInterpretationSchema.parse(JSON.parse(interpretationJson));
    const metadata = JSON.parse(metadataJson) as { senderDisplayName: string };
    const message = new MockSourceConnector(randomUUID(), metadata.senderDisplayName).normalizeEvent(JSON.parse(sourceJson));
    if (!message) throw new Error("The fixture source message is invalid.");
    originalText = message.text;
    senderDisplayName = message.senderDisplayName;
    name = fixture;
  }
  const output = path.resolve(values.output ?? path.join(repoRoot, "build/demo", `${name}${values.silent ? ".silent" : ""}.mp4`));
  if (path.extname(output).toLowerCase() !== ".mp4") throw new Error("The output filename must end in .mp4.");
  const messageId = randomUUID();
  const preferences = UserPreferencesSchema.parse({ targetLanguage: interpretation.targetLanguage });
  console.info(`Rendering ${name} in ${interpretation.targetLanguage} (${values.silent ? "silent preview" : "ElevenLabs narration"}).`);
  const speechStarted = performance.now();
  const speech: SpeechResult = values.silent
    ? { ...captionsOnlyTiming(interpretation.spokenSegments), audioPath: null, mode: "captions_only" }
    : await synthesizeSpeech(interpretation, messageId);
  if (!values.silent && speech.mode !== "voiced") {
    throw new Error(`ElevenLabs narration could not be generated (${speech.reason ?? "TTS_FAILED"}). Check the key/voice and ffprobe, then retry. Use --silent only for a silent preview.`);
  }
  const speechMs = Math.round(performance.now() - speechStarted);
  const timed = withTiming(interpretation, speech);
  console.info(`Narration: ${(timed.narrationMs / 1000).toFixed(1)}s; ${timed.captionSegments.length} caption phrases; ${timed.actionItems.length} actions.`);
  let lastProgress = -1;
  const renderer = new RemotionRenderer({ messageId, audioPath: speech.audioPath, senderDisplayName, source: "mock", isMock: true, originalText }, {
    onProgress(progress) {
      const milestone = Math.floor(progress * 10) * 10;
      if (milestone > lastProgress) { console.info(`Video export: ${milestone}%`); lastProgress = milestone; }
    },
  });
  const renderStarted = performance.now();
  const artifact = await renderer.render(timed, preferences);
  if (!artifact.videoPath) throw new Error("The renderer did not produce an MP4.");
  await mkdir(path.dirname(output), { recursive: true });
  if (path.resolve(artifact.videoPath) !== output) await copyFile(artifact.videoPath, output);
  const timings = { speechMs, renderMs: Math.round(performance.now() - renderStarted), totalMs: Math.round(performance.now() - started) };
  await writeFile(output.replace(/\.mp4$/i, ".json"), JSON.stringify({ ...artifact, videoPath: output, timings, gameplayCredit: "LoopScape Gameplays — https://www.youtube.com/watch?v=Iot_bB8lKgE — Creative Commons Attribution; edited excerpt" }, null, 2) + "\n");
  console.info(JSON.stringify({ videoPath: output, renderMode: artifact.renderMode, durationSeconds: timed.totalMs / 1000, ...timings }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Video export failed.");
  process.exitCode = 1;
});
