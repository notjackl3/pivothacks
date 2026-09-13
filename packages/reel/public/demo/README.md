# Narrated Studio sample

`professor-deadline.mp3` is ElevenLabs stock-voice narration generated for the
synthetic professor fixture in this repository. It contains no real student
messages. The adjacent JSON stores caption times relative to the audio start.

The default Remotion composition uses this local audio and its measured timing,
so `pnpm reel:preview` has sound without an API request. It displays Chinese and
English captions together. Use the Studio volume control if the preview is muted.

For fresh narration, set `ELEVENLABS_API_KEY` and run `pnpm reel:render`.
`pnpm reel:watch` opens a local player with an explicit Play with sound button.
