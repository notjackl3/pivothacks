# Video generation: one-hour implementation plan

## Agreed result

A vertical ReelRelay video in the Reddit-story format: selectable Subway Surfers,
Minecraft parkour, or GTA racing
gameplay, conversational narration in the recipient's language, and large captions
that pop in sync, with English translations underneath. Preserve every deadline, requirement, prohibition, and important
fact from the source message. Start with the existing Chinese demo fixture.

The deliverable is one playable, narrated H.264 MP4 at 720 × 1280 and 30 fps,
plus the existing renderer interface that the worker already calls.
Aim for roughly 30–45 seconds of narration; allow extra time for all action cards.

## Existing pieces to reuse

- `packages/reel/src/ReelComposition.tsx`: hook, narration, captions, action pages,
  and outro. Narration begins immediately; the compact hook shares the opening
  3.5 seconds with the first captions.
- `apps/server/src/tts/elevenlabs.ts`: speech synthesis and audio-duration probing.
- `apps/server/src/tts/timing.ts`: character-alignment mapping into caption times.
- `apps/server/src/render/RemotionRenderer.ts`: local H.264 rendering, bundled
  assets, duration validation, and the existing 20 MB output limit.
- `apps/server/src/worker/generateReel.ts`: orchestration and persisted artifacts.
- `packages/reel/public/gameplay/*.mp4`: the three prepared backgrounds.
  Keep the adjacent README's creator attribution with published reels.

Your module can start from a validated `MessageInterpretation` with a finished
script. The existing engine owns converting a raw incoming message into that
interpretation. The video handoff stays `ReelArtifact`, including a local
`videoPath`; the worker already handles upload and delivery.

## Sixty-minute schedule

| Minutes | Work | Concrete result |
| --- | --- | --- |
| 0–5 | Set `ELEVENLABS_API_KEY` locally; optionally pin `ELEVENLABS_VOICE_ID`. Check that `ffprobe` and Chrome/Edge are available. | Narration prerequisites are ready. |
| 5–15 | Add `GameplayBackground.tsx` and replace the calm background in the composition. Use the local MP4, muted, covering the full frame. Loop its 1,800 frames. | Gameplay runs continuously behind the content in Studio. |
| 15–30 | Restyle `Captions.tsx`: large white text, a strong dark outline, a small pop at each phrase boundary, and readable bilingual lines. Keep the sender/title compact and make the hook visible from the first frame. | The video has the requested story format and readable captions. |
| 30–45 | Add `scripts/render-demo.ts` that loads the existing professor interpretation, calls `synthesizeSpeech`, applies `withTiming`, and invokes `RemotionRenderer`. Mark fixture output as demo content. | A single local command drives the actual speech-to-video path. |
| 45–50 | Inspect a few rendered frames and fix clipping or layout problems. Run the changed packages' typecheck once if needed. | The composition is ready for the final export. |
| 50–60 | Export the full MP4, watch it with sound, confirm the last spoken sentence and every action card are present, save the demo copy, and push the finished files as Vy Tran. | A playable demo artifact and code the teammate can pull. |

For the background, the installed Remotion stack already supports
[`OffthreadVideo`](https://www.remotion.dev/docs/offthreadvideo) for server
rendering and [`Loop`](https://www.remotion.dev/docs/loop) for repeating the clip.
Use `staticFile("gameplay/subway-surfers.mp4")` as the source.

## Scope and integration decisions

- Use the shared narration offset and duration helpers consistently across
  audio, captions, sample props, and the renderer. Show the hook above the opening captions.
- Use the existing phrase timestamps for this milestone. Exact per-word
  highlighting can follow after the first complete export.
- Preserve the paged action recap; every item must remain visible. Give text
  enough contrast over the moving gameplay.
- Reuse the existing short-narration regeneration policy. Never cut off audio or
  remove an essential instruction to force a duration target.
- Use the known fixture for the first local render so video work can proceed
  independently of Supabase, Slack, Telegram, and Anthropic credentials. This is
  a fixture-driven demo, not evidence of a live source-to-delivery run.
- Keep the shared schemas and `ReelRenderer`/`ReelArtifact` contract stable. The
  teammate's UI and delivery code can continue using the existing pipeline.
- Treat scheduling, channel selection, and relationship-specific tone as upstream
  decisions. Render the supplied interpretation so context-routing work can
  proceed independently.
- Work in `packages/reel/**`, the existing A-owned TTS/render paths if necessary,
  and the new local demo script. No additional dependencies are needed for the
  gameplay composition.
- Verification is one actual export and playback, plus a targeted compile check
  if needed. Do not add or run test suites for this milestone.

## Run the implementation

From the repository root, run `pnpm install --frozen-lockfile`, set
`ELEVENLABS_API_KEY` in `.env`, and run:

```sh
pnpm reel:render
```

This uses the synthetic `professor_deadline` fixture and writes
`build/demo/professor_deadline.mp4` plus a matching JSON artifact with caption
timestamps and render timings. `ELEVENLABS_VOICE_ID` is optional: an available
stock voice is selected automatically. `ffprobe` must be on PATH; Remotion uses
Chrome/Edge on Windows, or its own browser elsewhere.

```sh
pnpm reel:render professor_deadline --output build/demo/pitch.mp4
pnpm reel:render --background minecraft-parkour
pnpm reel:render --background gta-racing --reuse-narration build/demo/professor_deadline.json
pnpm reel:render --input message.json --output build/demo/custom.mp4
pnpm reel:render --silent
pnpm reel:preview
pnpm reel:watch
```

Custom JSON must contain `originalText`, `senderDisplayName`, and an
`interpretation` matching the shared `MessageInterpretation` schema. The script
only renders the supplied interpretation; it does not call the translation
engine. Local exports are labeled DEMO and need no database or messaging
accounts. Studio includes a local narrated sample and its actual caption timing.
The narration starts immediately. `pnpm reel:watch` serves the exported MP4 at
`http://localhost:4010`; click Play with sound to start unmuted. Use
`pnpm reel:watch --file build/demo/professor_deadline.bilingual.mp4` for a named
export. The player binds only to localhost and serves the selected video.

With no `--file`, the player lists the exported Subway Surfers, Minecraft parkour,
and GTA racing demos in a dropdown. A selection starts the chosen reel with sound.
Named backgrounds get their own filenames, so one export does not overwrite
another. `--reuse-narration` uses a matching local artifact's audio and timing;
it rejects a changed script or language and does not call ElevenLabs.
The Studio sidebar also has a voiced sample composition for each background.

For both languages on screen, add `interpretation.captionTranslation` with
`language: "en"`, an English `hook`, and `spokenSegments` containing exactly one
translation per primary segment. Translations stay visible across each sentence's
short caption phrases. The source narration and its timing remain intact. The
synthetic professor fixture includes these translations. Older interpretations
without the optional field remain supported.

Narrated export fails clearly if ElevenLabs or audio probing fails. `--silent`
explicitly selects a caption-only preview without calling ElevenLabs. The
existing worker still retains its caption-only fallback behavior.

The composition now loops the downloaded gameplay, shows the hook immediately,
and uses short, large caption phrases with timestamp-driven pop animations.
Deadline and prohibition captions are yellow. Every action remains on the
paged recap. Background credit is embedded in the video and documented in
`packages/reel/public/gameplay/README.md`.

## Handoff

The bilingual export completed in 110 seconds, including fresh voice generation.
`build/demo/professor_deadline.bilingual.mp4` is 30.89 seconds, 720 × 1280 at 30 fps,
H.264 with AAC audio, and 9,542,481 bytes. All fifteen caption phrases have English
translations; both recap pages show all four actions. Narration begins immediately
and runs through 21.55 seconds. Opening, caption, action, and outro frames were
inspected; audio decoding and volume were checked. The local player returned
HTTP 200 for the page and HTTP 206 for a media range request. Browser playback
could not be inspected because no browser was connected to the session.
Server and reel typechecks passed. No test suites were run.

The Minecraft parkour and GTA racing exports also completed at 30.89 seconds.
Their MP4 sizes are 6,624,696 and 14,713,391 bytes respectively, both below the
20 MB renderer limit. Both have all fifteen bilingual caption phrases. Decoding
their audio produces the same SHA-256 as the approved Subway Surfers demo.
Rendered frames were inspected, and the player serves all three choices with
HTTP 206 range support. The background selector and narration reuse command pass
the server and reel typechecks.

Provide the teammate with the exact render command, the exported MP4 path, the
gameplay credit, and the final commit hash. Keep generated demo outputs and
download tools under the ignored `build/` directory; commit the prepared gameplay
asset and implementation files. Pull before pushing to `main` and use the existing
Vy Tran repository identity.
