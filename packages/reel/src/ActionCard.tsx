import type { ActionItem } from "@reelrelay/shared";

export function ActionCard({ items, page, pageCount }: { items: ActionItem[]; page: number; pageCount: number }) {
  return <div style={{ position: "absolute", inset: "242px 38px 132px", backgroundColor: "#edf2ed", color: "#172a31", padding: "32px 30px", borderRadius: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid #c9d7d0", paddingBottom: 23, marginBottom: 8 }}>
      <span style={{ fontSize: 35, fontWeight: 700 }}>需要做什么</span>
      <span style={{ fontSize: 22, color: "#60786e" }}>{page + 1} / {pageCount}</span>
    </div>
    {items.map((item, index) => <div key={`${page}:${index}`} style={{ borderBottom: index === items.length - 1 ? "none" : "1px solid #c9d7d0", padding: "23px 0", display: "flex", alignItems: "flex-start", gap: 18 }}>
      <span style={{ flexShrink: 0, fontSize: 22, width: 35, height: 35, borderRadius: "50%", background: item.isNegation ? "#e8c5b7" : "#cfdfd7", color: item.isNegation ? "#853c2b" : "#244a40", textAlign: "center", lineHeight: "35px" }}>{item.isNegation ? "!" : page * 3 + index + 1}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: item.text.length > 80 ? 22 : item.text.length > 45 ? 27 : 31, lineHeight: 1.5, fontWeight: 700, wordBreak: "break-word", overflowWrap: "anywhere" }}>{item.text}</div>
        {item.dueText ? <div style={{ fontSize: item.dueText.length > 50 ? 19 : 23, color: "#466359", marginTop: 10, overflowWrap: "anywhere" }}>{item.dueText}</div> : null}
      </div>
    </div>)}
  </div>;
}
