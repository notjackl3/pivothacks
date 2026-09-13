(() => {
  const video = document.getElementById('video');
  const player = document.getElementById('player');
  const play = document.getElementById('play');
  const start = document.getElementById('start');
  const overlay = document.getElementById('start-overlay');
  const startLabel = document.getElementById('start-label');
  const sound = document.getElementById('sound');
  const fullscreen = document.getElementById('fullscreen');
  const seek = document.getElementById('seek');
  const elapsed = document.getElementById('elapsed');
  const duration = document.getElementById('duration');
  const status = document.getElementById('status');
  const download = document.getElementById('download');
  let generation = 0;
  let resumeAt = 0;
  let failed = false;

  const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function updateTime() {
    const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
    elapsed.textContent = formatTime(video.currentTime || 0);
    duration.textContent = hasDuration ? formatTime(video.duration) : '–:––';
    seek.disabled = !hasDuration;
    seek.value = hasDuration ? String(video.currentTime / video.duration * 1000) : '0';
    seek.setAttribute('aria-valuetext', `${elapsed.textContent} of ${duration.textContent}`);
  }

  function updateSound() {
    const muted = video.muted || video.volume === 0;
    player.classList.toggle('is-muted', muted);
    sound.setAttribute('aria-pressed', String(muted));
    sound.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
    sound.title = muted ? 'Turn sound on' : 'Mute sound';
  }

  function updatePlayback() {
    const playing = !failed && !video.paused && !video.ended;
    player.classList.toggle('is-playing', playing);
    overlay.hidden = playing;
    play.setAttribute('aria-label', playing ? 'Pause video' : 'Play with sound');
    play.title = playing ? 'Pause video' : 'Play with sound';
    startLabel.textContent = failed ? 'Reload preview' : video.ended ? 'Watch again with sound' : video.currentTime > 0 ? 'Resume with sound' : 'Play with sound';
    if (failed) return;
    player.dataset.state = playing ? 'playing' : 'ready';
    status.textContent = playing
      ? video.muted || video.volume === 0 ? 'Playing with sound muted.' : 'Sound is on. Sit back and catch up.'
      : video.ended ? 'That’s the whole story. Replay it or try another background.' : video.currentTime > 0 ? 'Paused. Pick up where you left off.' : 'Press play to watch with sound.';
  }

  async function playVideo(withSound = true) {
    const request = generation;
    if (failed) { failed = false; video.load(); }
    if (withSound) { video.muted = false; if (video.volume === 0) video.volume = 1; }
    if (video.ended) video.currentTime = 0;
    try { await video.play(); }
    catch (error) {
      if (request !== generation || error.name === 'AbortError' || failed) return;
      updatePlayback();
      status.textContent = 'Press play to start, or use Download MP4 to watch in a media player.';
    }
  }

  function togglePlayback() {
    if (!video.paused && !video.ended) video.pause();
    else void playVideo();
  }

  start.addEventListener('click', () => void playVideo());
  play.addEventListener('click', togglePlayback);
  video.addEventListener('click', togglePlayback);
  video.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.key.toLowerCase() === 'k') { event.preventDefault(); togglePlayback(); }
  });
  sound.addEventListener('click', () => {
    if (video.muted || video.volume === 0) { video.muted = false; video.volume = 1; }
    else video.muted = true;
  });
  seek.addEventListener('input', () => {
    if (Number.isFinite(video.duration)) video.currentTime = Number(seek.value) / 1000 * video.duration;
    updateTime();
  });

  document.querySelectorAll('input[name="background"]').forEach((choice) => {
    choice.addEventListener('change', () => {
      if (!choice.checked) return;
      const wasPlaying = !video.paused && !video.ended;
      resumeAt = video.ended ? 0 : video.currentTime;
      generation += 1;
      failed = false;
      video.pause();
      const query = '?background=' + encodeURIComponent(choice.value);
      video.src = '/video.mp4' + query;
      if (choice.value !== 'custom') video.poster = '/assets/' + encodeURIComponent(choice.value) + '-poster.jpg';
      else video.removeAttribute('poster');
      video.setAttribute('aria-label', choice.dataset.label + ' narrated video');
      document.getElementById('selected-label').textContent = choice.dataset.label;
      download.href = '/download.mp4' + query;
      download.download = 'reelrelay-' + choice.value + '.mp4';
      const credit = document.getElementById('credit');
      const creator = document.getElementById('creator');
      credit.hidden = !choice.dataset.creator;
      creator.textContent = choice.dataset.creator;
      creator.href = choice.dataset.source || '#';
      history.replaceState(null, '', '/' + query);
      updateTime();
      video.load();
      player.dataset.state = 'loading';
      status.textContent = 'Loading ' + choice.dataset.label + '…';
      if (wasPlaying) void playVideo(false);
    });
  });

  function updateMetadata() {
    if (resumeAt > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 0.1));
    resumeAt = 0;
    document.getElementById('media-info').textContent = `${video.videoWidth} × ${video.videoHeight} · MP4`;
    updateTime();
    updatePlayback();
  }
  video.addEventListener('loadedmetadata', updateMetadata);
  video.addEventListener('timeupdate', updateTime);
  video.addEventListener('durationchange', updateTime);
  ['play', 'playing', 'pause', 'ended', 'canplay'].forEach((event) => video.addEventListener(event, updatePlayback));
  video.addEventListener('volumechange', () => { updateSound(); updatePlayback(); });
  video.addEventListener('waiting', () => { player.dataset.state = 'loading'; });
  function showError() {
    failed = true;
    updatePlayback();
    player.dataset.state = 'error';
    status.textContent = 'This preview couldn’t load. Try reloading it or use Download MP4.';
  }
  video.addEventListener('error', showError);

  if (document.fullscreenEnabled || typeof video.webkitEnterFullscreen === 'function') {
    fullscreen.hidden = false;
    fullscreen.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.fullscreenEnabled) await player.requestFullscreen();
        else video.webkitEnterFullscreen();
      } catch { status.textContent = 'Fullscreen is unavailable. You can keep watching here.'; }
    });
    document.addEventListener('fullscreenchange', () => {
      const label = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
      fullscreen.setAttribute('aria-label', label);
      fullscreen.title = label;
    });
  }

  video.controls = false;
  document.getElementById('controls').hidden = false;
  overlay.hidden = false;
  updateTime();
  updateSound();
  updatePlayback();
  if (video.readyState >= 1) updateMetadata();
  if (video.error) showError();
})();
