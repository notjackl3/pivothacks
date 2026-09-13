import type { ComprehensionEngine, NormalizedMessage, UserPreferences } from "@reelrelay/shared";
import { config } from "../config.js";
import { ClaudeEngine } from "./ClaudeEngine.js";
import { StubEngine } from "./StubEngine.js";

let engine: ComprehensionEngine | undefined;
export function getEngine(): ComprehensionEngine {
  return engine ??= config.ENGINE_MODE === "stub" ? new StubEngine() : new ClaudeEngine();
}
export async function analyzeShorter(message: NormalizedMessage, prefs: UserPreferences) {
  const current = getEngine();
  if (current instanceof ClaudeEngine) {
    return current.analyzeWithInstruction(message, prefs, "Keep spokenSegments under 80 English-equivalent words. Preserve EVERY essential action and deadline. Compress everything else. If omitting nonessential narration, state its exact count and direct the student to the full action list. Never truncate a sentence or omit a prohibition.");
  }
  return current.analyze(message, prefs);
}
