import professor from "../../../fixtures/expected/professor_deadline.interpretation.json";
import { MessageInterpretationSchema } from "@reelrelay/shared";
import { BODY_START_MS, totalDurationMs } from "./timing.js";
import type { ReelProps } from "./props.js";
import { captionChunks, captionUnits } from "./captionChunks.js";

const interpretation = MessageInterpretationSchema.parse(professor);
const narrationMs = interpretation.spokenSegments.length * 3500;
const chunks = captionChunks(interpretation.spokenSegments);
const totalUnits = chunks.reduce((sum, text) => sum + captionUnits(text), 0);
let elapsedUnits = 0;
const captionSegments = chunks.map((text) => {
  const startMs = BODY_START_MS + Math.round(elapsedUnits / totalUnits * narrationMs);
  elapsedUnits += captionUnits(text);
  return { text, startMs, endMs: BODY_START_MS + Math.round(elapsedUnits / totalUnits * narrationMs) };
});
export const sampleProps: ReelProps = {
  interpretation: { ...interpretation, narrationMs, totalMs: totalDurationMs(narrationMs, interpretation.actionItems.length), captionSegments },
  senderDisplayName: "Professor Chen", source: "mock", isMock: true, audioSrc: null, width: 720, height: 1280,
};