import { pathToFileURL } from "node:url";
import { config, requireConfig } from "../apps/server/src/config.js";
import { getDb } from "../apps/server/src/db/client.js";
import { fixtureNames } from "../apps/server/src/connectors/mock/MockSourceConnector.js";

export async function demoUserId(args: string[]): Promise<string> {
  const flag = args.indexOf("--user");
  const specified = (flag >= 0 ? args[flag + 1] : undefined) ?? process.env.DEMO_USER_ID;
  if (specified) return specified;
  const { data, error } = await getDb().from("connections").select("user_id").eq("provider", "telegram").eq("status", "active").limit(3);
  if (error) throw new Error("Could not resolve the paired demo user. Pass --user <Supabase user UUID>.");
  const ids = [...new Set((data ?? []).map((row) => String(row.user_id)))];
  if (ids.length !== 1) throw new Error("Pair one Telegram user first, or pass --user <Supabase user UUID>.");
  return ids[0]!;
}
/** `--at 23:10` (today, machine-local) or a full ISO instant: pins the triage clock for this message (Pivot 03). */
export function resolveAt(args: string[]): string | undefined {
  const flag = args.indexOf("--at");
  const raw = flag >= 0 ? args[flag + 1] : undefined;
  if (!raw) return undefined;
  if (/^\d{2}:\d{2}$/.test(raw)) { const [h, m] = raw.split(":").map(Number) as [number, number]; const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error("--at expects HH:mm or an ISO-8601 instant.");
  return parsed.toISOString();
}
export async function setDemoClock(now: string | null): Promise<void> {
  const response = await fetch(new URL("/api/demo/clock", config.API_BASE_URL), { method: "POST", headers: { "Content-Type": "application/json", "x-demo-secret": requireConfig("DEMO_INJECT_SECRET") }, body: JSON.stringify({ now }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Clock update failed with HTTP ${response.status}: ${await response.text()}`);
}
export async function injectDemo(fixture: string, userId: string, at?: string): Promise<{ messageId: string; jobId: string; isMock: true }> {
  if (!fixtureNames.includes(fixture as (typeof fixtureNames)[number])) throw new Error(`Unknown fixture. Choose: ${fixtureNames.join(", ")}`);
  const response = await fetch(new URL("/api/demo/inject", config.API_BASE_URL), {
    method: "POST", headers: { "Content-Type": "application/json", "x-demo-secret": requireConfig("DEMO_INJECT_SECRET") },
    body: JSON.stringify({ fixture, userId, ...(at ? { at } : {}) }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Demo injection failed with HTTP ${response.status}: ${await response.text()}`);
  return await response.json() as { messageId: string; jobId: string; isMock: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.info("pnpm demo:inject professor_deadline [--user <Supabase UUID>] [--at 23:10 | --at <ISO>]\npnpm demo:inject --clock 08:00 | --clock <ISO> | --clock real   (Pivot 03: move the scheduler's clock)\nRequires a running server, DEMO_INJECT_SECRET, and a paired Telegram user. Injected messages are labeled MOCK.");
  } else if (args[0] === "--clock") {
    const value = args[1] === "real" || !args[1] ? null : resolveAt(["--at", args[1]]) ?? null;
    setDemoClock(value).then(() => console.info(value ? `Demo clock set to ${value}` : "Demo clock cleared (real time).")).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Clock update failed."); process.exitCode = 1; });
  } else {
    const at = resolveAt(args);
    demoUserId(args).then((id) => injectDemo(args[0] ?? "professor_deadline", id, at)).then((result) => console.info(JSON.stringify(result, null, 2))).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Injection failed."); process.exitCode = 1; });
  }
}
