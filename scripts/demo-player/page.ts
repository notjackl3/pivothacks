export type DemoVideo = {
  id: string;
  label: string;
  filePath: string;
  creator?: string;
  sourceUrl?: string;
};

const descriptions: Record<string, string> = {
  "subway-surfers": "Colorful runs. Familiar rhythm.",
  "minecraft-parkour": "One block at a time.",
  "gta-racing": "Stunt tracks. Full speed.",
  custom: "Your selected MP4",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="4"/></svg>';
const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/></svg>';

export function playerPage(videos: DemoVideo[], selected: DemoVideo): string {
  const isDemo = selected.id !== "custom";
  const selectedId = escapeHtml(selected.id);
  const choices = videos.map((video, index) => `
    <label class="clip-choice">
      <input type="radio" name="background" value="${escapeHtml(video.id)}" ${video.id === selected.id ? "checked" : ""}
        data-label="${escapeHtml(video.label)}" data-creator="${escapeHtml(video.creator ?? "")}" data-source="${escapeHtml(video.sourceUrl ?? "")}">
      <span class="clip-card">
        ${video.id === "custom" ? `<span class="clip-placeholder">${playIcon}</span>` : `<img src="/assets/${escapeHtml(video.id)}.jpg" alt="" width="360" height="270">`}
        <span class="clip-copy"><span class="clip-number">0${index + 1}</span><strong>${escapeHtml(video.label)}</strong><span class="clip-description">${descriptions[video.id] ?? "Gameplay preview"}</span></span>
        <span class="clip-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8"/></svg></span>
      </span>
    </label>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#f5f4ef">
  <title>Demo studio · ReelRelay</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='12' fill='%230f6d63'/%3E%3Cpath d='m16 11 14 9-14 9Z' fill='%23fff'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="/assets/player.css">
  <script src="/assets/player.js" defer></script>
</head>
<body>
  <div class="studio-shell">
    <header class="site-header">
      <a class="brand" href="/" aria-label="ReelRelay home"><span class="brand-mark">${playIcon}</span>ReelRelay<span class="brand-divider"></span><span class="brand-caption">Demo studio</span></a>
      <a class="download-button" id="download" href="/download.mp4?background=${selectedId}" download="reelrelay-${selectedId}.mp4">${downloadIcon}<span>Download MP4</span></a>
    </header>

    <main class="studio">
      <section class="setup" aria-labelledby="studio-title">
        <div class="intro">
          <p class="eyebrow"><span></span>A new way to catch up</p>
          <h1 id="studio-title">Your message,<br>in motion.</h1>
          <p class="intro-copy">${isDemo ? "The details you need. A voice you understand.<br>Pick a background and press play." : "Your video, ready to watch and share."}</p>
        </div>

        <form action="/" method="get" class="background-form">
          <fieldset>
            <legend><span class="section-index">01</span>Choose your background</legend>
            <div class="clip-list">${choices}</div>
          </fieldset>
          <noscript><button type="submit" class="fallback-button">View selected background</button></noscript>
        </form>

        ${isDemo ? `<section class="language-section" aria-labelledby="language-title">
          <h2 id="language-title"><span class="section-index">02</span>Made for your language</h2>
          <dl class="language-details">
            <div><dt>Narration</dt><dd><span class="language-symbol" lang="zh">中</span>Chinese<span class="native-label" lang="zh">中文</span></dd></div>
            <div><dt>On-screen captions</dt><dd>English<span class="language-plus">+</span><span lang="zh">中文</span></dd></div>
          </dl>
          <p class="voice-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/></svg>Narrated with ElevenLabs</p>
        </section>` : ""}
      </section>

      <section class="preview-section" aria-label="Video preview">
        <div class="preview-surface">
          <div class="preview-heading"><span>YOUR REEL</span><span class="preview-format">${isDemo ? "9:16" : "MP4"}<span>↗</span></span></div>
          <div class="player" id="player" data-state="ready">
            <div class="video-frame">
              <video id="video" controls playsinline preload="metadata" tabindex="0" aria-label="${escapeHtml(selected.label)} narrated video"
                ${isDemo ? `poster="/assets/${selectedId}-poster.jpg"` : ""} src="/video.mp4?background=${selectedId}">Your browser cannot play this video. Use Download MP4 to watch it in a media player.</video>
              <div class="start-overlay" id="start-overlay" hidden><button type="button" class="start-button" id="start">${playIcon}<span id="start-label">Play with sound</span></button></div>
              <div class="loading-badge" role="status">Loading preview…</div>
            </div>
            <div class="custom-controls" id="controls" hidden>
              <div class="control-row">
                <button type="button" class="icon-button transport" id="play" aria-label="Play with sound" title="Play with sound"><span class="play-icon">${playIcon}</span><span class="pause-icon">${pauseIcon}</span></button>
                <span class="time-display"><span id="elapsed">0:00</span><span class="time-divider">/</span><span id="duration">–:––</span></span>
                <button type="button" class="icon-button sound-control" id="sound" aria-label="Mute sound" title="Mute sound" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 4-6 5H2v6h3l6 5Z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-off" d="m16 9 6 6m0-6-6 6"/></svg></button>
                <button type="button" class="icon-button" id="fullscreen" aria-label="Enter fullscreen" title="Enter fullscreen" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg></button>
              </div>
              <label class="sr-only" for="seek">Video position</label><input class="seek" id="seek" type="range" min="0" max="1000" value="0" disabled>
            </div>
          </div>
          <div class="preview-caption"><strong id="selected-label">${escapeHtml(selected.label)}</strong><span id="media-info">${isDemo ? "720 × 1280 · MP4" : "MP4 video"}</span></div>
        </div>
        <p class="playback-status" id="status" role="status">Press play to watch with sound.</p>
        <p class="gameplay-credit" id="credit" ${selected.creator ? "" : "hidden"}>Gameplay by <a id="creator" href="${escapeHtml(selected.sourceUrl ?? "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(selected.creator ?? "")}</a><span> · CC Attribution</span></p>
      </section>
    </main>

    <footer class="site-footer"><span>Less reading. More understanding.</span><span>${isDemo ? "Sample message · Professor Chen" : "Local video preview"}</span></footer>
  </div>
</body>
</html>`;
}
