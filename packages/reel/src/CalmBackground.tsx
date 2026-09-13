import { AbsoluteFill, useCurrentFrame } from "remotion";

export function CalmBackground() {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ backgroundColor: "#101f2a", overflow: "hidden" }}>
    <div style={{ position: "absolute", width: 1200, height: 1200, borderRadius: "50%", top: -350 + Math.sin(frame / 210) * 25, left: -280, background: "radial-gradient(circle, #244b59 0%, transparent 67%)", opacity: 0.65 }} />
    <div style={{ position: "absolute", width: 680, height: 680, border: "1px solid #a6d0cf", opacity: 0.08, borderRadius: "50%", bottom: -230, right: -290 + Math.sin(frame / 280) * 15 }} />
  </AbsoluteFill>;
}
