// Pivot 03 demo clock. Precedence: per-message override (demo inject `--at`) → runtime override (POST /api/demo/clock)
// → DEMO_NOW env → real time. Production never sets any of these.
import { config } from "../config.js";

const perMessage = new Map<string, Date>();
let runtimeOverride: Date | null = null;

export function setDemoNowForMessage(messageId: string, iso: string): void { perMessage.set(messageId, new Date(iso)); }
export function setDemoClock(iso: string | null): Date | null { runtimeOverride = iso ? new Date(iso) : null; return runtimeOverride; }
export function demoClock(): Date | null { return runtimeOverride ?? (config.DEMO_NOW ? new Date(config.DEMO_NOW) : null); }
/** Clock for one message's triage decision. */
export function nowFor(messageId: string): Date {
  const pinned = perMessage.get(messageId);
  if (pinned) { perMessage.delete(messageId); return pinned; }
  return demoClock() ?? new Date();
}
/** Clock for the held-job scheduler. */
export function schedulerNow(): Date { return demoClock() ?? new Date(); }
