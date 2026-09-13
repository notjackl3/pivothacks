import type { TimedInterpretation } from "@reelrelay/shared";
import type { GameplayId } from "./gameplays.js";

export type ReelProps = {
  interpretation: TimedInterpretation;
  senderDisplayName: string;
  source: "slack" | "gmail" | "outlook" | "instagram" | "whatsapp" | "sms" | "mock";
  isMock: boolean;
  audioSrc: string | null;
  width: number;
  height: number;
  background?: GameplayId;
};
