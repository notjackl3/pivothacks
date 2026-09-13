import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame } from "remotion";
import { ACTION_GAP_MS, ACTION_PAGE_MS, BODY_START_MS, FPS, actionPages } from "./timing.js";
import type { ReelProps } from "./props.js";
import { CalmBackground } from "./CalmBackground.js";
import { Chip } from "./Chip.js";
import { Captions } from "./Captions.js";
import { ActionCard } from "./ActionCard.js";

export function ReelComposition({ interpretation, senderDisplayName, source, isMock, audioSrc, width, height }: ReelProps) {
  const frame = useCurrentFrame();
  const ms = frame / FPS * 1000;
  const pages = actionPages(interpretation.actionItems);
  const actionStart = BODY_START_MS + interpretation.narrationMs + ACTION_GAP_MS;
  const outroStart = actionStart + pages.length * ACTION_PAGE_MS;
  const pageIndex = Math.floor((ms - actionStart) / ACTION_PAGE_MS);
  const currentPage = pages[pageIndex];
  const caption = interpretation.captionSegments.find((segment) => ms >= segment.startMs && ms < segment.endMs);
  const hookOpacity = interpolate(ms, [1200, 1550, 3300, 3500], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ fontFamily: '"Reel Noto SC", "Reel Noto", sans-serif', fontWeight: 700, color: "#eef4f2" }}>
    <CalmBackground />
    <div style={{ width: 720, height: 1280, position: "absolute", transformOrigin: "top left", transform: `scale(${width / 720}, ${height / 1280})` }}>
      <Chip sender={senderDisplayName} source={source} urgency={interpretation.urgency} isMock={isMock} />
      {ms < BODY_START_MS ? <div style={{ position: "absolute", top: 440, left: 56, right: 56, fontSize: interpretation.hook.length > 28 ? 44 : 56, lineHeight: 1.4, opacity: hookOpacity, transform: `translateY(${(1 - hookOpacity) * 18}px)` }}>{interpretation.hook}</div> : null}
      {caption ? <Captions segment={caption} /> : null}
      {currentPage && ms < outroStart ? <ActionCard items={currentPage} page={pageIndex} pageCount={pages.length} /> : null}
      {ms >= outroStart ? <div style={{ position: "absolute", top: 500, left: 50, right: 50, textAlign: "center" }}>
        <div style={{ fontSize: 50, lineHeight: 1.4 }}>用中文回复</div>
        <div style={{ fontSize: 29, color: "#b8ceca", marginTop: 28 }}>点击视频下方的 Reply</div>
        <div style={{ fontSize: 23, color: "#91aaa6", marginTop: 32 }}>发送前，先核对英文草稿。</div>
      </div> : null}
      <div style={{ position: "absolute", bottom: 68, left: 50, right: 50, display: "flex", justifyContent: "space-between", gap: 20, fontSize: 18, color: "#a9bfbc" }}>
        <span>AI 辅助翻译</span><span>原文与完整事项见下方按钮</span>
      </div>
    </div>
    {audioSrc ? <Sequence from={Math.round(BODY_START_MS / 1000 * FPS)}><Audio src={audioSrc} /></Sequence> : null}
  </AbsoluteFill>;
}
