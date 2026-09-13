const negations: Record<string, RegExp> = {
  zh: /不要|不得|勿|请勿|不能|不再|绝不/u,
  vi: /(?:^|[^\p{L}])(?:không|đừng|chớ)(?=$|[^\p{L}])/iu,
  ko: /지\s*마|지\s*말|면\s*안|지\s*않|금지|불가/u,
  es: /(?:^|[^\p{L}])(?:no|nunca|jamás|tampoco)(?=$|[^\p{L}])/iu,
  fr: /(?:^|[^\p{L}])(?:pas|jamais|interdit|défendu|aucun(?:e)?)(?=$|[^\p{L}])|(?:^|[^\p{L}])n['’]/iu,
};

export function negationFor(language: string): RegExp {
  return negations[language.toLowerCase().split(/[-_]/)[0] ?? ""] ?? /\b(?:do not|don't|never|no longer|must not)\b/i;
}

/** Monday-first weekday names; retain existing Chinese short forms as aliases. */
export function localizedWeekdays(language: string): string[][] {
  try {
    const long = new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" });
    const short = new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(Date.UTC(2024, 0, 1 + index));
      const names = [long.format(day), short.format(day)];
      if (/^vi(?:-|$)/i.test(language)) names.push(index === 6 ? "chủ nhật" : `thứ ${index + 2}`);
      return names;
    });
  } catch { return Array.from({ length: 7 }, () => []); }
}

/** Normalize numeric local clock notation without treating AM and PM as equivalent. */
export function localizedTimeText(text: string, language?: string): string {
  const lang = language?.toLowerCase().split(/[-_]/)[0];
  if (lang === "ko") {
    return text.replace(/오후|저녁|밤/gu, "下午").replace(/오전|아침|새벽/gu, "上午")
      .replace(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/gu, (_, hour: string, minute: string | undefined) => `${hour}:${(minute ?? "0").padStart(2, "0")}`);
  }
  if (lang === "fr") {
    return text.replace(/\b(\d{1,2})\s*h(?:eures?)?(?:\s*(\d{2}))?(?![\p{L}\d])/giu, (_, hour: string, minute: string | undefined) => `${hour}:${minute ?? "00"}`)
      .replace(/(\d{1,2}:\d{2})\s*(?:de l['’]après-midi|du soir)/giu, "$1 PM")
      .replace(/(\d{1,2}:\d{2})\s*du matin/giu, "$1 AM");
  }
  if (lang === "es") {
    return text.replace(/(\d{1,2}:\d{2})\s*(?:de la tarde|de la noche)/giu, "$1 PM")
      .replace(/(\d{1,2}:\d{2})\s*(?:de la mañana|de la madrugada)/giu, "$1 AM");
  }
  if (lang === "vi") {
    return text.replace(/\b(\d{1,2})(?::(\d{2})|\s*giờ(?:\s*(\d{1,2})(?:\s*phút)?)?)\s*(sáng|chiều|tối|trưa|đêm)?/giu,
      (_, hour: string, colonMinute: string | undefined, spokenMinute: string | undefined, period: string | undefined) => {
        const suffix = !period ? "" : period.toLowerCase() === "sáng" || (period.toLowerCase() === "đêm" && Number(hour) === 12) ? " AM" : " PM";
        return `${hour}:${(colonMinute ?? spokenMinute ?? "0").padStart(2, "0")}${suffix} `;
      });
  }
  return text;
}
