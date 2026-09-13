# Demo studio

Run `pnpm reel:watch` from the repository root and open http://localhost:4010.
The player discovers rendered demos in `build/demo`. `--file path/to/video.mp4`
still opens a single custom MP4. No frontend build or external asset requests
are needed; the server serves only the listed player assets and demo videos.

The background choices preserve playback position and sound preference while
a video is playing. Play and replay buttons explicitly turn sound on. Native
video controls and a background-selection form remain available without
JavaScript. Keyboard users can tab through controls and use the seek slider's
arrow keys; Space or K on the focused video toggles playback.

The JPEG thumbnails are frames from the bundled gameplay. Poster images are
frames from the matching narrated sample MP4s. Recording sources and licenses
are documented in [the gameplay credits](../../packages/reel/public/gameplay/README.md).
These posters depict the included Chinese/English Professor Chen sample; update
them when replacing that sample's content.
