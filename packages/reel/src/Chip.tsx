export function Chip({ sender, source, urgency, isMock, targetLanguage = "zh-CN" }: { sender: string; source: string; urgency: "low" | "medium" | "high"; isMock: boolean; targetLanguage?: string }) {
  const chinese = targetLanguage.startsWith("zh");
  return <div style={{ position: "absolute", top: 64, left: 38, right: 38, display: "flex", alignItems: "center", gap: 17, padding: "19px 22px", borderRadius: 22, background: "rgba(15,17,25,0.94)", border: "1px solid rgba(255,255,255,0.17)" }}>
    <div style={{ width: 52, height: 52, flexShrink: 0, background: "#ff693d", color: "white", borderRadius: 17, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>R</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 25, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sender}</div>
      <div style={{ fontSize: 15, color: "#bfc2ce", marginTop: 4 }}>ReelRelay · {source === "mock" ? (chinese ? "示例消息" : "Sample message") : "Slack"}</div>
    </div>
    {isMock ? <span style={{ fontSize: 14, color: "#d1d2db", padding: "6px 8px", border: "1px solid #565864", borderRadius: 6 }}>DEMO</span> : null}
    {urgency === "high" ? <span style={{ fontSize: 15, color: "#17171c", background: "#ffec55", padding: "7px 11px", borderRadius: 8 }}>{chinese ? "重要" : "IMPORTANT"}</span> : null}
  </div>;
}