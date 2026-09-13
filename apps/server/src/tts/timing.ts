import { BODY_START_MS, totalDurationMs } from "@reelrelay/reel/timing";
import { attachCaptionTranslations, captionChunks, captionUnits } from "@reelrelay/reel/captions";
import type { CaptionSegment, MessageInterpretation, TimedInterpretation } from "@reelrelay/shared";

export type CharacterAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};
const whitespace = /\s/u;
const clean = (text: string) => text.normalize("NFKC").replace(/\s/gu, "");
export function spokenText(interp: MessageInterpretation): string {
  return interp.spokenSegments.join(/^(zh|ja|ko)(-|$)/i.test(interp.targetLanguage) ? "" : " ");
}
export function alignedTiming(segments: string[], alignment: CharacterAlignment, audioDurationMs?: number): { narrationMs: number; captionSegments: CaptionSegment[] } {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (!characters.length || characters.length !== starts.length || starts.length !== ends.length) throw new Error("Invalid character alignment lengths.");
  const glyphs: Array<{ text: string; start: number; end: number }> = [];
  characters.forEach((text, index) => {
    const start = starts[index]; const end = ends[index];
    if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || (index > 0 && start < (starts[index - 1] ?? 0))) throw new Error("Invalid character timestamps.");
    for (const character of text.normalize("NFKC")) {
      if (!whitespace.test(character)) glyphs.push({ text: character, start: Math.round(start * 1000), end: Math.round(end * 1000) });
    }
  });
  if (glyphs.map((glyph) => glyph.text).join("") !== segments.map(clean).join("")) throw new Error("Alignment does not match the narration text.");
  let offset = 0;
  let previousEnd = 0;
  const captionSegments = captionChunks(segments).map((text) => {
    const length = Array.from(clean(text)).length;
    const first = glyphs[offset]; const last = glyphs[offset + length - 1];
    if (!length || !first || !last) throw new Error("A narration segment is empty or unaligned.");
    offset += length;
    const start = Math.max(first.start, previousEnd);
    const end = Math.max(last.end, start + 1);
    previousEnd = end;
    return { text, startMs: BODY_START_MS + start, endMs: BODY_START_MS + end };
  });
  const narrationMs = Math.max(Math.ceil(audioDurationMs ?? 0), previousEnd, Math.ceil((ends.at(-1) ?? 0) * 1000));
  validateCaptionTiming(captionSegments, narrationMs);
  return { narrationMs, captionSegments };
}
export function captionsOnlyTiming(segments: string[]): { narrationMs: number; captionSegments: CaptionSegment[] } {
  let offset = 0;
  const captionSegments = segments.flatMap((text) => {
    const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    const other = Array.from(text.replace(/\s/gu, "")).length - cjk;
    const duration = 2200 + cjk * 90 + other * 60;
    const chunks = captionChunks([text]);
    const totalUnits = chunks.reduce((sum, chunk) => sum + captionUnits(chunk), 0);
    let elapsedUnits = 0;
    const timedChunks = chunks.map((chunk) => {
      const startMs = BODY_START_MS + offset + Math.round(elapsedUnits / totalUnits * duration);
      elapsedUnits += captionUnits(chunk);
      return { text: chunk, startMs, endMs: BODY_START_MS + offset + Math.round(elapsedUnits / totalUnits * duration) };
    });
    offset += duration;
    return timedChunks;
  });
  if (!captionSegments.length) throw new Error("Narration needs at least one caption.");
  return { narrationMs: offset, captionSegments };
}
export function withTiming(interp: MessageInterpretation, timing: { narrationMs: number; captionSegments: CaptionSegment[] }): TimedInterpretation {
  validateCaptionTiming(timing.captionSegments, timing.narrationMs);
  if (timing.captionSegments.map((segment) => clean(segment.text)).join("") !== interp.spokenSegments.map(clean).join("")) throw new Error("Captions must reproduce the complete narration.");
  const captionSegments = attachCaptionTranslations(timing.captionSegments, interp.spokenSegments, interp.captionTranslation?.spokenSegments);
  return { ...interp, ...timing, captionSegments, totalMs: totalDurationMs(timing.narrationMs, interp.actionItems.length) };
}
export function validateCaptionTiming(segments: CaptionSegment[], narrationMs: number): void {
  let previousEnd = BODY_START_MS;
  if (!Number.isFinite(narrationMs) || narrationMs <= 0) throw new Error("Invalid narration duration.");
  for (const segment of segments) {
    if (!segment.text.trim() || !Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs) || segment.startMs < previousEnd || segment.endMs <= segment.startMs || segment.endMs > BODY_START_MS + narrationMs) throw new Error("Captions overlap or fall outside the narration.");
    previousEnd = segment.endMs;
  }
}
