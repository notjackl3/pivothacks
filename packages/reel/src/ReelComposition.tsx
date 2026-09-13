import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame } from "remotion";
import { ACTION_GAP_MS, ACTION_PAGE_MS, BODY_START_MS, FPS, HOOK_MS, actionPages } from "./timing.js";
import type { ReelProps } from "./props.js";
import { GameplayBackground } from "./GameplayBackground.js";
import { Chip } from "./Chip.js";
import { Captions } from "./Captions.js";
import { ActionCard } from "./ActionCard.js";
import { captionUnits } from "./captionChunks.js";
import { getGameplay } from "./gameplays.js";

export function ReelComposition({ interpretation, senderDisplayName, source, isMock, audioSrc, width, height, background }: ReelProps) {
  const gameplay = getGameplay(background);
  const frame = useCurrentFrame();
  const ms = frame / FPS * 1000;
  const chinese = interpretation.targetLanguage.startsWith("zh");
  const pages = actionPages(interpretation.actionItems);
  const actionStart = BODY_START_MS + interpretation.narrationMs + ACTION_GAP_MS;
  const outroStart = actionStart + pages.length * ACTION_PAGE_MS;
  const pageIndex = Math.floor((ms - actionStart) / ACTION_PAGE_MS);
  const currentPage = pages[pageIndex];
  const caption = interpretation.captionSegments.find((segment) => ms >= segment.startMs && ms < segment.endMs);
  const hookOpacity = interpolate(ms, [0, HOOK_MS - 220, HOOK_MS], [1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const progress = Math.min(1, Math.max(0, (ms - BODY_START_MS) / interpretation.narrationMs));

  return <AbsoluteFill style={{ fontFamily: '"Reel Noto SC", "Reel Noto", sans-serif', fontWeight: 700, color: "white" }}>
    <GameplayBackground background={gameplay.id} />
    <div style={{ width: 720, height: 1280, position: "absolute", transformOrigin: "top left", transform: "scale(" + width / 720 + ", " + height / 1280 + ")" }}>
      <Chip sender={senderDisplayName} source={source} urgency={interpretation.urgency} isMock={isMock} targetLanguage={interpretation.targetLanguage} />
      <div style={{ position: "absolute", top: 177, left: 42, right: 42, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
        <div style={{ height: "100%", background: "#ffec55", transform: "scaleX(" + progress + ")", transformOrigin: "left" }} />
      </div>
      {ms < HOOK_MS ? <div style={{ position: "absolute", top: 216, left: 40, right: 40, opacity: hookOpacity, padding: "14px 18px", borderRadius: 12, background: "rgba(15,17,25,0.90)" }}>
        <div style={{ fontSize: Math.min(30, Math.floor(1000 / Math.max(1, captionUnits(interpretation.hook)))), lineHeight: 1.4, color: "#ffec55", overflowWrap: "anywhere", textWrap: "balance" }}>{interpretation.hook}</div>
        {interpretation.captionTranslation?.hook ? <div style={{ fontSize: 21, color: "#fff", marginTop: 6, lineHeight: 1.35 }}>{interpretation.captionTranslation.hook}</div> : null}
      </div> : null}
      {caption ? <Captions segment={caption} /> : null}
      {currentPage && ms < outroStart ? <ActionCard items={currentPage} page={pageIndex} pageCount={pages.length} targetLanguage={interpretation.targetLanguage} /> : null}
      {ms >= outroStart ? <div style={{ position: "absolute", top: 395, left: 40, right: 40, padding: "34px 28px", borderRadius: 24, background: "rgba(15,17,25,0.95)", border: "1px solid rgba(255,255,255,0.18)", textAlign: "center" }}>
        <div style={{ fontSize: 47, lineHeight: 1.4, color: "#ffec55" }}>{chinese ? "用你的语言回复。" : "Reply in your language."}</div>
        {chinese ? <div style={{ fontSize: 28, color: "white", marginTop: 10 }}>Reply in your language.</div> : null}
        <div style={{ fontSize: 25, color: "white", marginTop: 24 }}>{chinese ? "点击下方 Reply · Tap Reply below" : "Tap Reply below the video"}</div>
        <div style={{ fontSize: 21, color: "#c6c7d2", marginTop: 22 }}>{chinese ? "确认英文草稿后，再发送。" : "Review the English draft before sending."}</div>
      </div> : null}
      <div style={{ position: "absolute", bottom: 112, left: 40, right: 40, display: "flex", justifyContent: "space-between", gap: 15, fontSize: 16, color: "#e1e1e9" }}>
        <span>{chinese ? "中文 + English · AI 翻译" : "AI-assisted translation"}</span>
        <span>{audioSrc ? (chinese ? "原文与完整事项见下方按钮" : "Original + actions below") : (chinese ? "无配音预览" : "Silent preview")}</span>
      </div>
      <div style={{ position: "absolute", bottom: 46, left: 40, right: 40, color: "#c3c4ce", fontSize: 13, lineHeight: 1.6 }}>
        <div>Gameplay: {gameplay.creator} · {gameplay.license}</div>
        <div>{gameplay.sourceUrl.replace("https://www.", "")} · edited excerpt</div>
      </div>
    </div>
    {audioSrc ? <Sequence from={Math.round(BODY_START_MS / 1000 * FPS)}><Audio src={audioSrc} /></Sequence> : null}
  </AbsoluteFill>;
}
