import type { TimedInterpretation } from "@reelrelay/shared";

export type ReelProps = {
  interpretation: TimedInterpretation;
  senderDisplayName: string;
  source: "slack" | "gmail" | "outlook" | "instagram" | "whatsapp" | "sms" | "mock";
  isMock: boolean;
  audioSrc: string | null;
  width: number;
  height: number;
};
