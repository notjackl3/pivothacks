import { Composition, staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";
import { ReelComposition } from "./ReelComposition.js";
import { sampleProps } from "./sample.js";
import { FPS } from "./timing.js";
import type { ReelProps } from "./props.js";

if (typeof document !== "undefined") {
  void loadFont({ family: "Reel Noto SC", url: staticFile("fonts/NotoSansSC-Bold.ttf"), weight: "700" });
  void loadFont({ family: "Reel Noto", url: staticFile("fonts/NotoSans-Bold.ttf"), weight: "700" });
}
export function RemotionRoot() {
  return <Composition id="Reel" component={ReelComposition} durationInFrames={Math.ceil(sampleProps.interpretation.totalMs / 1000 * FPS)} fps={FPS} width={720} height={1280} defaultProps={sampleProps} calculateMetadata={({ props }: { props: ReelProps }) => ({ durationInFrames: Math.ceil(props.interpretation.totalMs / 1000 * FPS), width: props.width, height: props.height })} />;
}
