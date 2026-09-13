"use client";

import { useId, useState } from "react";
import type { PatchPreferencesRequest, PreferencesResponse, ReplyTone } from "@reelrelay/shared";
import { describeError, patchPreferences } from "@/lib/api";
import { LANGUAGE_OPTIONS, TONE_OPTIONS } from "@/lib/status";
import { Banner, Card, Chip, Input, Label, Select } from "@/components/ui";

export interface LanguagePickerProps {
  prefs: PreferencesResponse | null;
  loading: boolean;
  onSaved: (prefs: PreferencesResponse) => void;
  index?: number;
}

type SaveState = { kind: "idle" } | { kind: "saving"; field: keyof PatchPreferencesRequest } | { kind: "saved" } | { kind: "error"; message: string };

/** Target language + reply tone. Each change saves immediately — no extra click. */
export function LanguagePicker({ prefs, loading, onSaved, index = 0 }: LanguagePickerProps) {
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const ids = useId();

  async function update(patch: PatchPreferencesRequest, field: keyof PatchPreferencesRequest) {
    setSave({ kind: "saving", field });
    try {
      const next = await patchPreferences(patch);
      onSaved(next);
      setSave({ kind: "saved" });
    } catch (err) {
      setSave({ kind: "error", message: describeError(err) });
    }
  }

  const language = prefs?.targetLanguage ?? "zh-CN";
  const tone = prefs?.replyTone ?? "respectful_student";
  const quietStart = prefs?.quietStart ?? "22:00";
  const quietEnd = prefs?.quietEnd ?? "08:00";
  const knownLanguage = LANGUAGE_OPTIONS.some((option) => option.value === language);
  const disabled = loading || !prefs || save.kind === "saving";

  const statusChip =
    save.kind === "saving" ? (
      <Chip tone="accent" size="md" active>
        Saving
      </Chip>
    ) : save.kind === "saved" ? (
      <Chip tone="success" size="md">
        Saved
      </Chip>
    ) : prefs ? (
      <Chip tone="success" size="md">
        Set
      </Chip>
    ) : (
      <Chip tone="neutral" size="md">
        Loading
      </Chip>
    );

  return (
    <Card eyebrow="Step 4" title="Language & tone" description="The reel is narrated and captioned in this language; replies are drafted in English from what you type." action={statusChip} index={index}>
      <div className="space-y-4">
        {save.kind === "error" && (
          <Banner tone="danger" onDismiss={() => setSave({ kind: "idle" })}>
            {save.message}
          </Banner>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-language`}>Target language</Label>
            <Select id={`${ids}-language`} value={language} disabled={disabled} onChange={(event) => void update({ targetLanguage: event.target.value }, "targetLanguage")}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {!knownLanguage && <option value={language}>{language} (custom)</option>}
            </Select>
            <p className="text-xs text-ink-faint">Simplified Chinese is the tested demo language; the others run through the same pipeline untested.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-tone`}>Reply tone</Label>
            <Select id={`${ids}-tone`} value={tone} disabled={disabled} onChange={(event) => void update({ replyTone: event.target.value as ReplyTone }, "replyTone")}>
              {TONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-ink-faint">How English drafts sound. You always review before anything is sent.</p>
          </div>
        </div>
        <div className="space-y-1.5 rounded-xl border border-line bg-surface-muted px-4 py-3">
          <Label htmlFor={`${ids}-quiet-start`} hint="urgent messages still come through">
            Quiet hours
          </Label>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <Input id={`${ids}-quiet-start`} type="time" value={quietStart} disabled={disabled} className="w-32 font-mono" onChange={(event) => void update({ quietStart: event.target.value }, "quietStart")} />
            <span>to</span>
            <Input id={`${ids}-quiet-end`} type="time" value={quietEnd} disabled={disabled} className="w-32 font-mono" aria-label="Quiet hours end" onChange={(event) => void update({ quietEnd: event.target.value }, "quietEnd")} />
          </div>
          <p className="text-xs text-ink-faint">
            Routine reels are held until quiet hours end. Low-priority ones wait for the 8 AM or 6 PM digest. High urgency, a deadline within 24 h, or a sensitive message from a professor, employer or landlord is sent right away as a text card, with the reel behind it.
          </p>
        </div>
        {prefs?.timezone && (
          <p className="text-xs text-ink-faint">
            Deadlines and quiet hours are interpreted in <span className="font-mono text-ink-muted">{prefs.timezone}</span>.
          </p>
        )}
      </div>
    </Card>
  );
}
