# Video generation: one-hour implementation plan

## Agreed result

A vertical ReelRelay video in the Reddit-story format: looping Subway Surfers
gameplay, conversational narration in the recipient's language, and large captions
that pop in sync. Preserve every deadline, requirement, prohibition, and important
fact from the source message. Start with the existing Chinese demo fixture.

The deliverable is one playable, narrated H.264 MP4 at 720 × 1280 and 30 fps,
plus the existing renderer interface that the worker already calls.
Aim for roughly 30–45 seconds of narration; allow extra time for all action cards.

## Existing pieces to reuse

- `packages/reel/src/ReelComposition.tsx`: hook, narration, captions, action pages,
  and outro. The initial narration offset is 3.5 seconds.
- `apps/server/src/tts/elevenlabs.ts`: speech synthesis and audio-duration probing.
- `apps/server/src/tts/timing.ts`: character-alignment mapping into caption times.
- `apps/server/src/render/RemotionRenderer.ts`: local H.264 rendering, bundled
  assets, duration validation, and the existing 20 MB output limit.
- `apps/server/src/worker/generateReel.ts`: orchestration and persisted artifacts.
- `packages/reel/public/gameplay/subway-surfers.mp4`: the selected background.
  Keep the adjacent README's creator attribution with published reels.

Your module can start from a validated `MessageInterpretation` with a finished
script. The existing engine owns converting a raw incoming message into that
interpretation. The video handoff stays `ReelArtifact`, including a local
`videoPath`; the worker already handles upload and delivery.

## Sixty-minute schedule

| Minutes | Work | Concrete result |
| --- | --- | --- |
| 0–5 | Confirm ElevenLabs access, choose one voice, and set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` locally. Check that `ffprobe` and Chrome/Edge are available. | Narration prerequisites are ready. |
| 5–15 | Add `GameplayBackground.tsx` and replace the calm background in the composition. Use the local MP4, muted, covering the full frame. Loop its 1,800 frames. | Gameplay runs continuously behind the content in Studio. |
| 15–30 | Restyle `Captions.tsx`: large white text, a strong dark outline, a small pop at each phrase boundary, and at most two readable lines. Keep the sender/title compact and make the hook visible from the first frame. | The video has the requested story format and readable captions. |
| 30–45 | Add `scripts/render-demo.ts` that loads the existing professor interpretation, calls `synthesizeSpeech`, applies `withTiming`, and invokes `RemotionRenderer`. Mark fixture output as demo content. | A single local command drives the actual speech-to-video path. |
| 45–50 | Inspect a few rendered frames and fix clipping or layout problems. Run the changed packages' typecheck once if needed. | The composition is ready for the final export. |
| 50–60 | Export the full MP4, watch it with sound, confirm the last spoken sentence and every action card are present, save the demo copy, and push the finished files as Vy Tran. | A playable demo artifact and code the teammate can pull. |

For the background, the installed Remotion stack already supports
[`OffthreadVideo`](https://www.remotion.dev/docs/offthreadvideo) for server
rendering and [`Loop`](https://www.remotion.dev/docs/loop) for repeating the clip.
Use `staticFile("gameplay/subway-surfers.mp4")` as the source.

## Scope and integration decisions

- Use the existing narration offset and duration helpers consistently across
  audio, captions, sample props, and the renderer. Show the hook during the intro.
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

## Narration prerequisite

ElevenLabs is confirmed: the user has an API key available. Set it and one voice
ID in the local environment before the first voiced render. The existing code
uses `ffprobe` to measure the result.
It falls back to silent captions when speech cannot be generated. A silent
preview is useful for layout work, but does not complete the narrated-video
deliverable. Confirm this prerequisite before spending time on visual polish.

## Handoff

Provide the teammate with the exact render command, the exported MP4 path, the
gameplay credit, and the final commit hash. Keep generated demo outputs and
download tools under the ignored `build/` directory; commit the prepared gameplay
asset and implementation files. Pull before pushing to `main` and use the existing
Vy Tran repository identity.
