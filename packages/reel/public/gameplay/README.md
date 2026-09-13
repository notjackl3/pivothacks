# Gameplay backgrounds

These local backgrounds are 60-second, silent H.264 clips at 720 × 1280 and
30 fps (1,800 frames each). They loop behind the separate narration track.
Use `--background subway-surfers`, `--background minecraft-parkour`,
`--background gta-racing`, `--background geometry-dash`, or
`--background temple-run` with `pnpm reel:render`. The composition and artifact
metadata automatically include the selected recording's attribution.

## Subway Surfers

- Recording: vertical Subway Surfers gameplay, fall edition.
- Creator: [LoopScape Gameplays](https://www.youtube.com/@LoopScapeVideos).
- Source: [original video](https://www.youtube.com/watch?v=Iot_bB8lKgE), uploaded November 27, 2024.
- Downloaded: September 13, 2026.
- Source license metadata: Creative Commons Attribution (reuse allowed).
- The creator's description expressly permits using the recording as background footage.

Keep the source attribution with any published reels that use this recording:

> Gameplay provided by LoopScape Gameplays: https://www.youtube.com/watch?v=Iot_bB8lKgE. Edited excerpt; Creative Commons Attribution. See the original video for the license statement.

The prepared asset uses the 00:30–01:30 excerpt, encoded as a silent H.264 MP4 at
720 × 1280, 30 fps, with web playback metadata at the start of the file.
The raw download and downloader tools stay in the ignored `build/` directory.

## Minecraft parkour

- File: `minecraft-parkour.mp4`.
- Recording: lava-cave parkour, with no commentary or HUD over the route.
- Creator: [No Copyright Gameplay](https://www.youtube.com/NoCopyrightGameplays).
- Source: [Minecraft Parkour Gameplay - Free To Use](https://www.youtube.com/watch?v=jN1Se8JPyKs), uploaded January 12, 2024.
- Downloaded September 13, 2026; source excerpt 00:30–01:30.
- Source metadata specifies Creative Commons Attribution (reuse allowed).
- The description permits background and voiceover reuse with added content;
  it prohibits reuploading the full recording and claiming ownership.
- The prepared clip is center-cropped from 16:9 to 9:16 and converted to 30 fps.

Credit for published videos:

> Gameplay by No Copyright Gameplay: https://www.youtube.com/NoCopyrightGameplays. Source: https://www.youtube.com/watch?v=jN1Se8JPyKs. Cropped, silent excerpt; Creative Commons Attribution.

## GTA racing

- File: `gta-racing.mp4`.
- Recording: GTA V stunt race with loops, wall rides, and ramps.
- Creator: [Dope Gameplays](https://www.youtube.com/@nocopyrightgameplay4u).
- Source: [GTA 5 Stunt Race - 148](https://www.youtube.com/watch?v=qAI0mrCzDp0), uploaded February 12, 2023.
- Downloaded September 13, 2026; source excerpt 00:30–01:30.
- The creator's description states Creative Commons Attribution and permits
  edited commentary and voiceover reuse. YouTube's separate license metadata
  field was empty. The description prohibits claiming the full recording as yours.
- The prepared clip is center-cropped from 16:9 to 9:16 and converted to 30 fps.

Credit for published videos:

> Gameplay by Dope Gameplays: https://www.youtube.com/@nocopyrightgameplay4u. Source: https://www.youtube.com/watch?v=qAI0mrCzDp0. Cropped, silent excerpt; Creative Commons Attribution as stated by the creator.

## Geometry Dash

- File: `geometry-dash.mp4`.
- Creator: [Jason Mc](https://www.youtube.com/@JasonTrMc).
- Source: [Geometry Dash Background Gameplay](https://www.youtube.com/watch?v=xYawLx-0VPw), uploaded April 26, 2020.
- Downloaded September 13, 2026; source excerpt 01:10–02:10.
- The creator recorded the levels and explicitly permits using the footage as
  a background for narrated YouTube videos. The YouTube license metadata field
  is empty, so this clip is labeled creator-permitted reuse rather than CC.
- The prepared clip removes the original game/music audio and uses a 360 × 640
  crop at (280, 40) from the 1280 × 720 recording to keep the player visible.
  It is scaled to 720 × 1280. Narration is a separate track.

Credit for published videos:

> Gameplay by Jason Mc: https://www.youtube.com/@JasonTrMc. Source: https://www.youtube.com/watch?v=xYawLx-0VPw. Cropped, silent excerpt; background reuse permitted in the creator's description.

## Temple Run

- File: `temple-run.mp4`.
- Recording: Temple Run, with forest paths, bridges and gold coins.
- Creator: [Whipped](https://www.youtube.com/@WhippedCreations).
- Source: [Temple Run Gameplay (2024)](https://www.youtube.com/watch?v=-WVLJcxT214), uploaded February 2, 2024.
- Downloaded September 13, 2026; source excerpt 00:33–01:33.
- The creator explicitly permits background reuse for narrated stories and
  other videos. Credit is appreciated but not required by that statement.
  The YouTube license metadata field is empty; this is creator-permitted reuse.
- The prepared clip removes the original audio and side bars using a 404 × 720
  crop at (438, 0), scales to 720 × 1280, and converts the 60 fps recording to
  the renderer's 30 fps timeline.

Credit for published videos:

> Gameplay by Whipped: https://www.youtube.com/@WhippedCreations. Source: https://www.youtube.com/watch?v=-WVLJcxT214. Cropped, silent excerpt; background reuse permitted in the creator's description.

Render both with the existing demo narration, then restart the player:

```sh
pnpm reel:render --background geometry-dash --reuse-narration build/demo/professor_deadline.json
pnpm reel:render --background temple-run --reuse-narration build/demo/professor_deadline.json
pnpm reel:watch
```

Verified September 13, 2026: both prepared clips decode at 720 × 1280, 30 fps,
with 1,800 frames and no game audio. Both narrated demos export as 30.89-second
H.264/AAC MP4s with a -4.1 dB audio peak. Caption and action-card frames were
reviewed. The studio serves five choices, and both new videos, thumbnails,
posters, byte-range playback and download endpoints passed local HTTP checks.
Renderer/server type checks and player syntax checks passed. Browser automation
was unavailable, so interactive browser playback was not exercised.
