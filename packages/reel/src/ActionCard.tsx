import type { ActionItem } from "@reelrelay/shared";

export function ActionCard({ items, page, pageCount, targetLanguage = "zh-CN" }: { items: ActionItem[]; page: number; pageCount: number; targetLanguage?: string }) {
  return <div style={{ position: "absolute", top: 245, left: 38, right: 38, background: "rgba(15,17,25,0.95)", color: "white", padding: "30px 28px", borderRadius: 24, border: "1px solid rgba(255,255,255,0.2)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #41424e", paddingBottom: 22, marginBottom: 4 }}>
      <span style={{ fontSize: 34, color: "#ffec55" }}>{targetLanguage.startsWith("zh") ? "接下来要做" : "YOUR NEXT STEPS"}</span>
      <span style={{ fontSize: 19, color: "#c0c2ce" }}>{page + 1} / {pageCount}</span>
    </div>
    {items.map((item, index) => <div key={page + ":" + index} style={{ borderBottom: index === items.length - 1 ? "none" : "1px solid #41424e", padding: "23px 0", display: "flex", alignItems: "flex-start", gap: 17 }}>
      <span style={{ flexShrink: 0, fontSize: 21, width: 34, height: 34, borderRadius: 10, background: item.isNegation ? "#ff795f" : "#ffec55", color: "#15171e", textAlign: "center", lineHeight: "34px" }}>{item.isNegation ? "!" : page * 3 + index + 1}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: item.text.length > 80 ? 22 : item.text.length > 45 ? 27 : 31, lineHeight: 1.4, overflowWrap: "anywhere" }}>{item.text}</div>
        {item.dueText ? <div style={{ fontSize: item.dueText.length > 50 ? 19 : 23, color: "#ffec55", marginTop: 10, overflowWrap: "anywhere" }}>{item.dueText}</div> : null}
      </div>
    </div>)}
  </div>;
}