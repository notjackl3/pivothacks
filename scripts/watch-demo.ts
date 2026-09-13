import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { gameplays, gameplayIds } from "../packages/reel/src/gameplays.js";

const { values } = parseArgs({
  args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
  options: { file: { type: "string" }, port: { type: "string", default: "4010" } },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Choose a port from 1 to 65535.");
type DemoVideo = { id: string; label: string; filePath: string };
const candidates: DemoVideo[] = values.file
  ? [{ id: "custom", label: "Selected video", filePath: path.resolve(values.file) }]
  : gameplayIds.map((id) => ({ id, label: gameplays[id].label, filePath: path.resolve("build/demo", `professor_deadline${id === "subway-surfers" ? "" : `.${id}`}.mp4`) }));
const videos = (await Promise.all(candidates.map(async (video) => {
  const info = await stat(video.filePath).catch(() => null);
  return info?.isFile() && info.size > 0 && path.extname(video.filePath).toLowerCase() === ".mp4" ? video : null;
}))).filter((video): video is DemoVideo => video !== null);
const firstVideo = videos[0];
if (!firstVideo) throw new Error("No demo MP4 found. Run pnpm reel:render first, or pass --file path/to/video.mp4.");

function playerPage(selected: DemoVideo): string {
  const options = videos.map((video) => `<option value="${video.id}"${video.id === selected.id ? " selected" : ""}>${video.label}</option>`).join("");
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ReelRelay video demo</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#101116;color:#fff;font:16px system-ui,sans-serif;display:grid;place-items:center;padding:24px}main{width:min(100%,420px)}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}h1{font-size:18px;margin:0}header span{color:#bfc2ce;font-size:13px}label{display:block;font-size:13px;color:#bec1cd;margin:0 0 7px}select{width:100%;padding:11px 12px;margin-bottom:16px;background:#20222b;color:#fff;border:1px solid #41444f;border-radius:10px;font:600 15px system-ui}video{display:block;width:100%;max-height:65vh;background:#050508;border:1px solid #34363e;border-radius:16px}button{width:100%;padding:14px;margin-top:16px;border:0;border-radius:10px;background:#ffec55;color:#111;font:700 16px system-ui;cursor:pointer}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #fff;outline-offset:4px}p{min-height:20px;color:#bec1cd;font-size:13px;line-height:1.5}footer{display:flex;justify-content:space-between;align-items:center;gap:12px}a{color:#fff;font-size:13px;flex-shrink:0}
</style>
<main><header><h1>ReelRelay</h1><span>Video demo</span></header>
<label for="background">Gameplay background / 游戏背景</label><select id="background">${options}</select>
<video id="video" controls playsinline preload="metadata" src="/video.mp4?background=${selected.id}">Your browser cannot play this video. Download the MP4 below.</video>
<button id="play" type="button">Play with sound / 播放声音</button>
<footer><p id="status" role="status">Click Play with sound to start.</p><a id="download" href="/download.mp4?background=${selected.id}" download="reelrelay-${selected.id}.mp4">Download MP4</a></footer></main>
<script>
const video=document.getElementById('video'),button=document.getElementById('play'),status=document.getElementById('status'),background=document.getElementById('background'),download=document.getElementById('download');
async function playWithSound(){video.muted=false;video.volume=1;if(video.ended)video.currentTime=0;try{await video.play();status.textContent='Sound is on. Adjust the volume below the video.';}catch{status.textContent='Playback was blocked. Use the video controls or download the MP4.';}}
button.addEventListener('click',playWithSound);
background.addEventListener('change',()=>{const choice=encodeURIComponent(background.value);video.pause();video.src='/video.mp4?background='+choice;download.href='/download.mp4?background='+choice;download.download='reelrelay-'+background.value+'.mp4';history.replaceState(null,'','/?background='+choice);video.load();void playWithSound();});
video.addEventListener('volumechange',()=>{status.textContent=video.muted||video.volume===0?'Sound is muted. Click Play with sound.':'Sound is on.';});
video.addEventListener('error',()=>{status.textContent='This browser could not play the file. Download the MP4 and open it in a media player.';});
</script></html>`;
}

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
    const url = new URL(request.url ?? "/", "http://localhost");
    const id = url.searchParams.get("background");
    const selected = id ? videos.find((video) => video.id === id) : firstVideo;
    if (!selected) { response.writeHead(404); response.end("Unknown background."); return; }
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : playerPage(selected));
      return;
    }
    if (url.pathname !== "/video.mp4" && url.pathname !== "/download.mp4") { response.writeHead(404); response.end(); return; }
    const info = await stat(selected.filePath);
    response.setHeader("Content-Type", "video/mp4");
    response.setHeader("Accept-Ranges", "bytes");
    if (url.pathname === "/download.mp4") response.setHeader("Content-Disposition", `attachment; filename="reelrelay-${selected.id}.mp4"`);
    let start = 0;
    let end = info.size - 1;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        response.writeHead(416, { "Content-Range": `bytes */${info.size}` }); response.end(); return;
      }
      response.statusCode = 206;
      response.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    }
    response.setHeader("Content-Length", end - start + 1);
    if (request.method === "HEAD") { response.end(); return; }
    const stream = createReadStream(selected.filePath, { start, end });
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  } catch {
    if (response.headersSent) response.destroy();
    else { response.writeHead(404); response.end("The video is unavailable. Render it again and restart the player."); }
  }
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.info(`Watch with sound: http://localhost:${port}\nBackgrounds: ${videos.map((video) => video.label).join(", ")}`));
