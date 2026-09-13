import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { actionPages, totalDurationMs } from "@reelrelay/reel/timing";
import { gameplays, getGameplay, type GameplayId } from "@reelrelay/reel/gameplays";
import { TimedInterpretationSchema, type ReelArtifact, type ReelRenderer, type TimedInterpretation, type UserPreferences } from "@reelrelay/shared";
import { config, dataDir, repoRoot } from "../config.js";
import { validateCaptionTiming } from "../tts/timing.js";

let bundlePromise: Promise<string> | undefined;
async function localBrowser(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  for (const candidate of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]) {
    try { await access(candidate); return candidate; } catch { /* Remotion can download its own browser when none is installed. */ }
  }
  return null;
}
export async function prepareRenderer(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const publicDir = path.join(repoRoot, "packages/reel/public");
      await access(path.join(publicDir, "fonts/NotoSansSC-Bold.ttf"));
      await access(path.join(publicDir, "fonts/NotoSans-Bold.ttf"));
      await Promise.all(Object.values(gameplays).map((clip) => access(path.join(publicDir, clip.file))));
      return bundle({ entryPoint: path.join(repoRoot, "packages/reel/src/index.ts"), rootDir: path.join(repoRoot, "packages/reel"), publicDir, outDir: path.join(dataDir, "bundle"), enableCaching: true, webpackOverride: (current) => ({ ...current, resolve: { ...current.resolve, extensionAlias: { ...current.resolve?.extensionAlias, ".js": [".ts", ".tsx", ".js"] } } }) });
    })().catch((error: unknown) => { bundlePromise = undefined; throw error; });
  }
  return bundlePromise;
}
export type RenderContext = Pick<ReelArtifact, "messageId" | "senderDisplayName" | "source" | "isMock" | "originalText" | "audioPath">;
export class RemotionRenderer implements ReelRenderer {
  constructor(private readonly context: RenderContext, private readonly options: { background?: GameplayId; onProgress?: (progress: number) => void } = {}) {}
  async render(interp: TimedInterpretation, _prefs: UserPreferences): Promise<ReelArtifact> {
    TimedInterpretationSchema.parse(interp);
    validateCaptionTiming(interp.captionSegments, interp.narrationMs);
    const renderedActions = actionPages(interp.actionItems).flat();
    if (renderedActions.length !== interp.actionItems.length || renderedActions.some((item, index) => item !== interp.actionItems[index])) throw new Error("A6: every action must appear on the action cards.");
    if (interp.totalMs !== totalDurationMs(interp.narrationMs, interp.actionItems.length)) throw new Error("Video duration must include every action page.");
    const directory = path.join(dataDir, "video");
    await mkdir(directory, { recursive: true });
    const serveUrl = await prepareRenderer();
    const browserExecutable = await localBrowser();
    const inputProps = { interpretation: interp, senderDisplayName: this.context.senderDisplayName, source: this.context.source, isMock: this.context.isMock, background: getGameplay(this.options.background).id, width: config.REEL_WIDTH, height: config.REEL_HEIGHT, audioSrc: this.context.audioPath ? `data:audio/mpeg;base64,${(await readFile(this.context.audioPath)).toString("base64")}` : null };
    const composition = await selectComposition({ serveUrl, id: "Reel", inputProps, browserExecutable, timeoutInMilliseconds: config.RENDER_TIMEOUT_MS });
    const outputLocation = path.join(directory, `${this.context.messageId}.mp4`);
    for (const crf of [26, 30]) {
      const { cancel, cancelSignal } = makeCancelSignal();
      const timer = setTimeout(cancel, config.RENDER_TIMEOUT_MS);
      try {
        await renderMedia({ composition, serveUrl, inputProps, browserExecutable, codec: "h264", crf, audioCodec: "aac", concurrency: 2, outputLocation, timeoutInMilliseconds: config.RENDER_TIMEOUT_MS, cancelSignal, imageFormat: "jpeg", overwrite: true, onProgress: ({ progress }) => this.options.onProgress?.(progress) });
      } finally { clearTimeout(timer); }
      if ((await stat(outputLocation)).size <= 20 * 1024 * 1024) return { ...this.context, videoPath: outputLocation, durationMs: interp.totalMs, renderMode: this.context.audioPath ? "remotion" : "captions_only", interpretation: interp };
    }
    throw Object.assign(new Error("Video exceeds the 20 MB limit after compression."), { code: "RENDER" });
  }
}
