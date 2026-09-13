export function Chip({ sender, source, urgency, isMock }: { sender: string; source: string; urgency: "low" | "medium" | "high"; isMock: boolean }) {
  return <div style={{ position: "absolute", top: 76, left: 50, right: 50 }}>
    <div style={{ fontSize: 19, color: "#a9c8cc", letterSpacing: 4, marginBottom: 20 }}>REELRELAY</div>
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span style={{ color: "#eef4f2", fontSize: 25 }}>{sender} · {source === "mock" ? "Demo" : "Slack"}</span>
      {urgency !== "low" ? <span style={{ fontSize: 16, color: urgency === "high" ? "#f4cda1" : "#bdcfc7", border: "1px solid #61716f", borderRadius: 6, padding: "5px 10px" }}>{urgency === "high" ? "请留意" : "待处理"}</span> : null}
    </div>
    {isMock ? <div style={{ fontSize: 17, color: "#f4cda1", marginTop: 10 }}>DEMO-INJECTED · 模拟消息</div> : null}
  </div>;
}
