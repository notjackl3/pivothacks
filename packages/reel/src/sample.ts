import { staticFile } from "remotion";
import professor from "../../../fixtures/expected/professor_deadline.interpretation.json";
import narration from "../public/demo/professor-deadline.timing.json";
import { MessageInterpretationSchema } from "@reelrelay/shared";
import { BODY_START_MS, totalDurationMs } from "./timing.js";
import type { ReelProps } from "./props.js";
import { attachCaptionTranslations } from "./captionChunks.js";

const interpretation = MessageInterpretationSchema.parse(professor);
const captionSegments = attachCaptionTranslations(narration.captionSegments.map((caption) => ({
  ...caption, startMs: caption.startMs + BODY_START_MS, endMs: caption.endMs + BODY_START_MS,
})), interpretation.spokenSegments, interpretation.captionTranslation?.spokenSegments);
export const sampleProps: ReelProps = {
  interpretation: { ...interpretation, narrationMs: narration.narrationMs, totalMs: totalDurationMs(narration.narrationMs, interpretation.actionItems.length), captionSegments },
  senderDisplayName: "Professor Chen", source: "mock", isMock: true,
  audioSrc: staticFile("demo/professor-deadline.mp3"), width: 720, height: 1280,
};
