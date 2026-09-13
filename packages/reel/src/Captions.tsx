import type { CaptionSegment } from "@reelrelay/shared";

export function Captions({ segment }: { segment: CaptionSegment }) {
  const units = Array.from(segment.text).reduce((sum, char) => sum + (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) ? 1 : 0.6), 0);
  const fontSize = Math.min(44, Math.floor(1100 / Math.max(1, units)));
  return <div style={{ position: "absolute", left: 42, right: 42, top: "39%", backgroundColor: "rgba(0,0,0,0.60)", borderRadius: 16, padding: "34px 30px", border: "1px solid rgba(220,240,238,0.12)" }}>
    <div style={{ fontSize, lineHeight: 1.55, fontWeight: 700, textAlign: "center", color: "white", wordBreak: "break-all", textShadow: "0 2px 3px #000" }}>{segment.text}</div>
  </div>;
}
