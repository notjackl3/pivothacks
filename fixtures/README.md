These are synthetic student messages, not real personal data. `expected/*.interpretation.json` are hand-authored development fixtures; they are not evidence of model accuracy. Run `node scripts/generate-fixtures.mjs` to regenerate them.

The fixture engine is enabled only with `ENGINE_MODE=stub`, and accepts only an exact matching source fixture. Live mode requires an Anthropic key and never silently supplies a canned translation. Tier B translation quality must be checked by a bilingual teammate before the pitch.
