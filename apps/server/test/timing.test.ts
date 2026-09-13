import { describe, expect, it } from "vitest";
import { actionPages, totalDurationMs } from "@reelrelay/reel/timing";
import type { ActionItem } from "@reelrelay/shared";
import { alignedTiming, captionsOnlyTiming, validateCaptionTiming } from "../src/tts/timing.js";

describe("caption and action timing", () => {
  it("starts narration at 3.5 seconds and retains the actual audio tail", () => {
    const result = alignedTiming(["你好", "世界"], { characters: ["你", "好", "世", "界"], character_start_times_seconds: [0, 0.4, 0.8, 1.2], character_end_times_seconds: [0.4, 0.8, 1.2, 1.6] }, 2000);
    expect(result.captionSegments).toEqual([{ text: "你好", startMs: 3500, endMs: 4300 }, { text: "世界", startMs: 4300, endMs: 5100 }]);
    expect(result.narrationMs).toBe(2000);
  });
  it("ignores whitespace while preserving Unicode code points", () => {
    const result = alignedTiming(["你 好", "😀"], { characters: ["你", " ", "好", "😀"], character_start_times_seconds: [0, 0.1, 0.4, 1], character_end_times_seconds: [0.4, 0.4, 1, 2] });
    expect(result.captionSegments.map((segment) => segment.text)).toEqual(["你 好", "😀"]);
  });
  it("rejects mismatched or malformed alignment rather than inventing synchronization", () => {
    expect(() => alignedTiming(["你好"], { characters: ["再", "见"], character_start_times_seconds: [0, 1], character_end_times_seconds: [1, 2] })).toThrow(/match/);
    expect(() => alignedTiming(["你好"], { characters: ["你", "好"], character_start_times_seconds: [0], character_end_times_seconds: [1, 2] })).toThrow(/length/);
  });
  it("makes readable silent captions with no overlaps", () => {
    const result = captionsOnlyTiming(["不要上传压缩包。", "周五下午5:00前提交 PDF。"]);
    expect(() => validateCaptionTiming(result.captionSegments, result.narrationMs)).not.toThrow();
    expect(result.captionSegments[0]?.endMs).toBe(result.captionSegments[1]?.startMs);
    expect(result.captionSegments.at(-1)?.endMs).toBe(3500 + result.narrationMs);
  });
  it("places all four demo actions on two pages and budgets time for both", () => {
    const items = Array.from({ length: 4 }, (_, index) => ({ text: `Action ${index}` }) as ActionItem);
    expect(actionPages(items).map((page) => page.length)).toEqual([3, 1]);
    expect(actionPages(items).flat()).toEqual(items);
    expect(totalDurationMs(28000, 4)).toBe(40800);
  });
});
