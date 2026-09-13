import type { ActionItem } from "@reelrelay/shared";

export const FPS = 30;
export const BODY_START_MS = 3500;
export const ACTION_GAP_MS = 300;
export const ACTION_PAGE_MS = 3500;
export const OUTRO_MS = 2000;
export function actionPages(items: ActionItem[]): ActionItem[][] {
  return Array.from({ length: Math.ceil(items.length / 3) }, (_, index) => items.slice(index * 3, index * 3 + 3));
}
export function totalDurationMs(narrationMs: number, actionCount: number): number {
  return BODY_START_MS + narrationMs + ACTION_GAP_MS + ACTION_PAGE_MS * Math.ceil(actionCount / 3) + OUTRO_MS;
}
