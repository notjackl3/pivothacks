import professor from "../../../fixtures/expected/professor_deadline.interpretation.json";
import { MessageInterpretationSchema } from "@reelrelay/shared";
import { BODY_START_MS, totalDurationMs } from "./timing.js";
import type { ReelProps } from "./props.js";

const interpretation = MessageInterpretationSchema.parse(professor);
const narrationMs = interpretation.spokenSegments.length * 3500;
export const sampleProps: ReelProps = {
  interpretation: { ...interpretation, narrationMs, totalMs: totalDurationMs(narrationMs, interpretation.actionItems.length), captionSegments: interpretation.spokenSegments.map((text, i) => ({ text, startMs: BODY_START_MS + i * 3500, endMs: BODY_START_MS + (i + 1) * 3500 })) },
  senderDisplayName: "Professor Chen", source: "mock", isMock: true, audioSrc: null, width: 720, height: 1280,
};
