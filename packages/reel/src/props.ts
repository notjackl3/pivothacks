import type { TimedInterpretation } from "@reelrelay/shared";

export type ReelProps = {
  interpretation: TimedInterpretation;
  senderDisplayName: string;
  source: "slack" | "mock";
  isMock: boolean;
  audioSrc: string | null;
  width: number;
  height: number;
};
