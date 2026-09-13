import { AbsoluteFill, Loop, OffthreadVideo, staticFile } from "remotion";

export function GameplayBackground() {
  return <AbsoluteFill style={{ backgroundColor: "#11131a" }}>
    <Loop durationInFrames={1800}>
      <OffthreadVideo src={staticFile("gameplay/subway-surfers.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </Loop>
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(8,10,16,0.75) 0%, rgba(8,10,16,0.08) 29%, rgba(8,10,16,0.05) 62%, rgba(8,10,16,0.84) 100%)" }} />
  </AbsoluteFill>;
}