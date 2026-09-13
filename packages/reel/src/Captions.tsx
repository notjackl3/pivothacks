import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionSegment } from "@reelrelay/shared";
import { captionUnits } from "./captionChunks.js";

export function Captions({ segment }: { segment: CaptionSegment }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame / fps * 1000 - segment.startMs;
  const scale = interpolate(elapsed, [0, 90, 170], [0.94, 1.025, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fontSize = Math.min(78, Math.floor(1080 / Math.max(1, captionUnits(segment.text))));
  const emphasized = /\d|不要|不得|不能|\b(?:not|never|don't)\b/iu.test(segment.text);
  return <div style={{ position: "absolute", left: 38, right: 38, top: "43%", transform: "translateY(-50%)", textAlign: "center" }}>
    <div style={{ fontSize, lineHeight: 1.3, fontWeight: 700, color: emphasized ? "#ffec55" : "#ffffff", WebkitTextStroke: "5px #101016", paintOrder: "stroke fill", textShadow: "0 5px 0 #101016, 0 8px 18px rgba(0,0,0,0.65)", overflowWrap: "anywhere", wordBreak: "normal", textWrap: "balance", transform: "scale(" + scale + ")" }}>{segment.text}</div>
    {segment.translation ? <div lang="en" style={{ display: "inline-block", maxWidth: "100%", marginTop: 22, padding: "12px 18px", borderRadius: 12, background: "rgba(12,14,22,0.90)", fontSize: segment.translation.length > 95 ? 25 : 30, lineHeight: 1.35, color: "#fff", overflowWrap: "anywhere", textWrap: "balance" }}>{segment.translation}</div> : null}
  </div>;
}
