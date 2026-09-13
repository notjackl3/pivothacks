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