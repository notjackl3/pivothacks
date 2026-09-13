import type { CaptionSegment } from "@reelrelay/shared";

const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const words = new Intl.Segmenter("en", { granularity: "word" });

export function captionUnits(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + (cjk.test(char) ? 1 : /\s/u.test(char) ? 0.3 : 0.55), 0);
}

/** Short display phrases; the original narration and its facts stay intact. */
export function captionChunks(segments: string[]): string[] {
  return segments.flatMap((segment) => {
    const chunks: string[] = [];
    let current = "";
    let wordCount = 0;
    for (const part of words.segment(segment)) {
      if (part.isWordLike && current.trim() && (captionUnits(current + part.segment) > 10 || wordCount >= 4)) {
        chunks.push(current.trim());
        current = "";
        wordCount = 0;
      }
      current += part.segment;
      if (part.isWordLike) wordCount++;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  });
}

/** Keep the translated sentence visible across all of its short timed phrases. */
export function attachCaptionTranslations(captions: CaptionSegment[], segments: string[], translations?: string[]): CaptionSegment[] {
  if (!translations) return captions;
  if (translations.length !== segments.length || translations.some((text) => !text.trim())) {
    throw new Error("Each narration segment needs exactly one caption translation.");
  }
  const clean = (text: string) => text.normalize("NFKC").replace(/\s/gu, "");
  let segmentIndex = 0;
  let consumed = "";
  const result = captions.map((caption) => {
    const source = clean(segments[segmentIndex] ?? "");
    consumed += clean(caption.text);
    if (!source || !source.startsWith(consumed)) throw new Error("Caption translation does not match the narration boundaries.");
    const translation = translations[segmentIndex];
    if (consumed === source) { segmentIndex++; consumed = ""; }
    return { ...caption, translation };
  });
  if (segmentIndex !== segments.length || consumed) throw new Error("Caption translations must cover the complete narration.");
  return result;
}
