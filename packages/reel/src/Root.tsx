import { Composition, staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";
import { ReelComposition } from "./ReelComposition.js";
import { sampleProps } from "./sample.js";
import { FPS } from "./timing.js";
import type { ReelProps } from "./props.js";
import type { GameplayId } from "./gameplays.js";

if (typeof document !== "undefined") {
  void loadFont({ family: "Reel Noto SC", url: staticFile("fonts/NotoSansSC-Bold.ttf"), weight: "700" });
  void loadFont({ family: "Reel Noto", url: staticFile("fonts/NotoSans-Bold.ttf"), weight: "700" });
}
export function RemotionRoot() {
  const variants: Array<{ id: string; background: GameplayId }> = [
    { id: "Reel", background: "subway-surfers" },
    { id: "MinecraftParkour", background: "minecraft-parkour" },
    { id: "GtaRacing", background: "gta-racing" },
  ];
  return <>{variants.map(({ id, background }) => <Composition key={id} id={id} component={ReelComposition} durationInFrames={Math.ceil(sampleProps.interpretation.totalMs / 1000 * FPS)} fps={FPS} width={720} height={1280} defaultProps={{ ...sampleProps, background }} calculateMetadata={({ props }: { props: ReelProps }) => ({ durationInFrames: Math.ceil(props.interpretation.totalMs / 1000 * FPS), width: props.width, height: props.height })} />)}</>;
}
