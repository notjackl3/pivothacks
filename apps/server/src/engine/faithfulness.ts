import type { MessageInterpretation } from "@reelrelay/shared";

export type FaithfulnessIssue = { check: "A1" | "A2" | "A3" | "A4" | "A5"; message: string; actionIndex?: number };
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
const compact = (text: string) => normalize(text).replace(/[\s\p{P}\p{S}]/gu, "");
const sourceNegation = /\b(?:do not|don't|never|no longer|must not)\b/i;
const chineseNegation = /不要|不得|勿|请勿|不能|不再|绝不/;
const weekdays: Record<string, string[]> = {
  monday: ["monday", "周一", "星期一"], tuesday: ["tuesday", "周二", "星期二"],
  wednesday: ["wednesday", "周三", "星期三"], thursday: ["thursday", "周四", "星期四"],
  friday: ["friday", "周五", "星期五"], saturday: ["saturday", "周六", "星期六"],
  sunday: ["sunday", "周日", "周天", "星期日", "星期天"],
};
const knownPlatforms = ["Quercus", "Slack", "GitHub", "PDF", "ZIP", "ID", "RSVP"];

type TimeToken = { hour: number; minute: number; period: "am" | "pm" | null; raw: string };
function times(text: string): TimeToken[] {
  const result: TimeToken[] = [];
  const pattern = /(?:(凌晨|早上|上午|中午|下午|傍晚|晚上)\s*)?(\d{1,2})(?::(\d{2}))\s*(AM|PM)?|\b(\d{1,2})\s*(AM|PM)\b/giu;
  for (const match of text.normalize("NFKC").matchAll(pattern)) {
    const hour = Number(match[2] ?? match[5]);
    const minute = Number(match[3] ?? 0);
    if (hour > 23 || minute > 59) continue;
    let period: "am" | "pm" | null = (match[4] ?? match[6])?.toLowerCase() as "am" | "pm" | undefined ?? null;
    if (match[1]) period = /中午|下午|傍晚|晚上/.test(match[1]) ? "pm" : "am";
    if (period && (hour < 1 || hour > 12)) continue;
    result.push({ hour, minute, period, raw: match[0].trim() });
  }
  return result;
}
function hour24(time: TimeToken): number {
  return time.period ? time.hour % 12 + (time.period === "pm" ? 12 : 0) : time.hour;
}
export function containsTime(text: string, source: string): boolean {
  const expected = times(source);
  const present = times(text);
  return expected.every((item) => present.some((candidate) => {
    if (candidate.minute !== item.minute) return false;
    // A translated explicit AM/PM must agree. A 24-hour form is also accepted.
    if (item.period && candidate.period) return hour24(item) === hour24(candidate);
    if (item.period && !candidate.period) return candidate.hour === hour24(item);
    return hour24(item) === hour24(candidate);
  }));
}
function dueCovered(due: string, narration: string): boolean {
  const normalized = normalize(narration);
  if (!containsTime(narration, due)) return false;
  let recognized = times(due).length > 0;
  for (const [day, variants] of Object.entries(weekdays)) {
    if (!normalize(due).includes(day)) continue;
    recognized = true;
    if (!variants.some((variant) => normalized.includes(variant))) return false;
  }
  const date = /\b\d{4}-\d{2}-\d{2}\b/g;
  for (const match of due.matchAll(date)) {
    recognized = true;
    if (!normalized.includes(match[0])) return false;
  }
  return recognized || compact(narration).includes(compact(due));
}
function anchors(english: string): string[] {
  const urls = english.match(/https?:\/\/[^\s<>]+/g)?.map((url) => url.replace(/[.,;!?]+$/, "")) ?? [];
  const platforms = knownPlatforms.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(english));
  const codes = english.match(/\b[A-Z]+\d+[A-Z\d]*\b/g) ?? [];
  return [...urls, ...platforms, ...codes];
}

/** Deterministic guardrails, not a claim that a translation is semantically correct. */
export function checkFaithfulness(original: string, interpretation: MessageInterpretation): FaithfulnessIssue[] {
  const issues: FaithfulnessIssue[] = [];
  const normalizedOriginal = normalize(original);
  const narration = interpretation.spokenSegments.join("");
  const narrationCompact = compact(narration);
  const facts = [interpretation.faithfulTranslation, ...interpretation.preservedFacts.map((fact) => fact.value)].join("\n");

  if (interpretation.captionTranslation && interpretation.captionTranslation.spokenSegments.length !== interpretation.spokenSegments.length) {
    issues.push({ check: "A2", message: "captionTranslation.spokenSegments must contain exactly one translation for each narration segment, in the same order." });
  }

  interpretation.actionItems.forEach((action, actionIndex) => {
    if (!normalizedOriginal.includes(normalize(action.evidenceQuote))) issues.push({ check: "A1", actionIndex, message: "Evidence must be a verbatim excerpt of the original message." });
    if (action.dueText && !normalizedOriginal.includes(normalize(action.dueText))) issues.push({ check: "A1", actionIndex, message: "dueText must be copied from the original message." });
    if (action.dueAt && (!action.dueText || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(action.dueAt) || Number.isNaN(Date.parse(action.dueAt)))) issues.push({ check: "A1", actionIndex, message: "dueAt needs a valid timestamp with timezone and supporting dueText, or null." });
    if (!action.essential) return;
    if (action.dueText && !dueCovered(action.dueText, narration)) issues.push({ check: "A2", actionIndex, message: `Narration must include this item's deadline: ${action.dueText}` });
    const tokens = anchors(action.textEnglish);
    if (tokens.length && !tokens.every((token) => narrationCompact.includes(compact(token)))) issues.push({ check: "A2", actionIndex, message: `Narration is missing action anchors: ${tokens.join(", ")}` });
    if (!tokens.length && !action.dueText && !narrationCompact.includes(compact(action.text))) issues.push({ check: "A2", actionIndex, message: "Narrate this essential item's target-language text verbatim, splitting it across captions if necessary." });
    if (action.isNegation) {
      const negation = interpretation.targetLanguage.startsWith("zh") ? chineseNegation : sourceNegation;
      if (!negation.test(narration) || !negation.test(action.text)) issues.push({ check: "A2", actionIndex, message: "Preserve the negation in both the action text and narration." });
      // A generic 'do not' elsewhere is not enough to preserve this specific prohibition.
      if (!narrationCompact.includes(compact(action.text))) issues.push({ check: "A2", actionIndex, message: "Narrate the complete negated action verbatim, including its object." });
    }
  });
  if (sourceNegation.test(original) && !interpretation.actionItems.some((action) => action.isNegation)) issues.push({ check: "A3", message: "The original includes a prohibition; include it as a negated action." });
  const negatedSentences = original.split(/(?<=[.!?。！？])\s*/u).filter((sentence) => sourceNegation.test(sentence));
  for (const sentence of negatedSentences) {
    if (!interpretation.actionItems.some((action) => action.isNegation && sourceNegation.test(action.evidenceQuote) && normalize(sentence).includes(normalize(action.evidenceQuote)))) {
      issues.push({ check: "A3", message: "Each separate prohibition in the original must have a negated action with its own evidence." });
    }
  }
  for (const time of times(original)) {
    if (!normalize(facts).includes(normalize(time.raw)) && !containsTime(facts, time.raw)) issues.push({ check: "A4", message: `Missing or changed time: ${time.raw}` });
  }
  const urls = original.match(/https?:\/\/[^\s<>]+/g)?.map((url) => url.replace(/[.,;!?]+$/, "")) ?? [];
  const amounts = original.match(/(?:[$£€¥]\s*\d[\d,]*(?:\.\d{2})?|\b(?:USD|CAD|EUR|GBP)\s*\d[\d,]*(?:\.\d{2})?)/g) ?? [];
  for (const fact of [...urls, ...amounts]) {
    if (!normalize(facts).includes(normalize(fact))) issues.push({ check: "A4", message: `Missing source fact: ${fact}` });
  }
  if (/(?:moved from[\s\S]+?to|changed[\s\S]+?to|instead of)/i.test(original)) {
    const dates = new Set(interpretation.actionItems.map((action) => action.dueText).filter(Boolean));
    const oldDeadline = interpretation.preservedFacts.find((fact) => fact.label === "old_deadline" && fact.value && normalizedOriginal.includes(normalize(fact.value)));
    if (dates.size < 2 && !oldDeadline) issues.push({ check: "A5", message: "Preserve both old and new deadlines; include old_deadline with source evidence." });
  }
  return issues;
}
export const validateFaithfulness = checkFaithfulness;
