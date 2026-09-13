# Language checks

The setup dropdown supports Simplified Chinese (`zh-CN`), Vietnamese (`vi`),
Korean (`ko`), Spanish (`es`) and French (`fr`). Narration and primary captions
use the selected language, with English captions alongside them. Reply drafts
are in English, with a meaning check in the selected language.

## Observed results — 2026-09-13

All five languages passed live OpenAI translation and English reply drafting,
ElevenLabs narration, bilingual caption rendering and MP4 export for the sample:

> Please submit the PDF to Quercus by Friday at 5:00 PM. Do not upload the ZIP file.

| Language | Result | Duration | Audio peak | Speech model | Detected speech |
| --- | --- | --- | --- | --- | --- |
| Simplified Chinese | Passed | 11.65 s | -4.9 dB | Multilingual v2 | Chinese (`zho`) |
| Vietnamese | Passed | 11.20 s | -4.3 dB | Flash v2.5 | Vietnamese (`vie`) |
| Korean | Passed | 11.87 s | -4.2 dB | Multilingual v2 | Korean (`kor`) |
| Spanish | Passed | 12.25 s | -4.3 dB | Multilingual v2 | Spanish (`spa`) |
| French | Passed | 12.16 s | -3.8 dB | Multilingual v2 | French (`fra`) |

Every exported file contains H.264 video and audible AAC audio at 720×1280.
Caption timing and export duration checks passed. Reviewed caption and action
card frames showed the expected scripts and accents without missing glyphs or
clipped text. Automatic Scribe v2 transcription of the exported MP4s detected
the expected language and retained the prohibition in all five, without forcing
a language code. This is an automated check of a short sample, not a native
speaker review; transcription spellings of Quercus and the Korean time varied.

The final export run reused the verified live OpenAI interpretations from the
text check, then made fresh reply and narration requests. Local evidence is in
`build/language-check/live/results.json`, the five MP4s, review frames and
`*.transcript.json`. These generated files are ignored by Git.

The 43 focused language/faithfulness checks passed, as did type checks for the
server, reel renderer and web app. Server health and the setup page returned
HTTP 200; the server process started after the updated keys were saved.
Browser automation was unavailable, so this
does not verify changing and saving preferences through the setup UI. No live
Slack or Telegram delivery was exercised.

## Reproduce

From the repository root:

```powershell
pnpm exec tsx scripts/check-languages.ts --live
```

This uses a synthetic two-instruction message, makes real translation and reply
drafting requests, generates real ElevenLabs narration, and exports each MP4.
It checks the selected language, secondary captions, deadlines, prohibitions,
caption timing, H.264/AAC streams, video duration and audible audio levels.
It writes three review frames per language as well as the input, reply, speech
timing, artifact and results JSON to `build/language-check/live/` (gitignored).
It does not send a Slack or Telegram message or change a user's preferences.

Configure `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` in the root `.env`.
`LLM_PROVIDER=openai` with `LLM_API_KEY` is also accepted. OpenAI uses
`gpt-5-mini` by default; `OPENAI_MODEL` overrides that. Anthropic remains
available through `ENGINE_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.

Useful narrower runs:

```powershell
pnpm exec tsx scripts/check-languages.ts --live --language ko
pnpm exec tsx scripts/check-languages.ts --live --text-only
pnpm exec tsx scripts/check-languages.ts --live --reuse-audio
pnpm exec tsx scripts/check-languages.ts --silent
pnpm --filter @reelrelay/server exec vitest run test/languages.test.ts test/faithfulness.test.ts
```

`--reuse-audio` reuses matching saved interpretations and narration when present;
it still validates the script, timing and exported video. `--silent` uses the
authored translations from `samples.ts` and checks caption rendering only. It
does not prove live translation or narration. Ordinary live runs make billable
provider requests.

## Fixes covered

- OpenAI's structured output constrains `targetLanguage` to the selected code
  and requires the secondary caption track to use `en`. The common engine
  rejects a mismatched language or missing English captions before narration.
- Deadline and prohibition checks recognize Vietnamese, Korean, Spanish and
  French instead of applying English/Chinese-only rules to them.
- Vietnamese routes from Multilingual v2 to Flash v2.5, which supports it.
  Other explicitly configured models are preserved. See the
  [ElevenLabs model language table](https://elevenlabs.io/docs/overview/models).
- Korean narration preserves spaces between chunks. Noto Sans KR supplies all
  11,172 Hangul syllables; the previously bundled fonts supplied none.
- The setup dropdown uses short language names and explains the English
  secondary captions without exposing internal testing labels.

OpenAI uses the [Responses structured output API](https://developers.openai.com/api/docs/guides/structured-outputs)
with `store: false`; generated data still passes the application's existing
schema checks and corrective retry.
