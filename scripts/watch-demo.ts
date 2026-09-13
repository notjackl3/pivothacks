import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
  options: { file: { type: "string", default: "build/demo/professor_deadline.mp4" }, port: { type: "string", default: "4010" } },
});
const videoPath = path.resolve(values.file);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Choose a port from 1 to 65535.");
const info = await stat(videoPath).catch(() => { throw new Error("Demo MP4 not found. Run pnpm reel:render first, or pass --file path/to/video.mp4."); });
if (!info.isFile() || path.extname(videoPath).toLowerCase() !== ".mp4") throw new Error("Choose an MP4 file.");

const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ReelRelay video demo</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#101116;color:#fff;font:16px system-ui,sans-serif;display:grid;place-items:center;padding:24px}main{width:min(100%,420px)}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}h1{font-size:18px;margin:0}header span{color:#bfc2ce;font-size:13px}video{display:block;width:100%;max-height:72vh;background:#050508;border:1px solid #34363e;border-radius:16px}button{width:100%;padding:14px;margin-top:16px;border:0;border-radius:10px;background:#ffec55;color:#111;font:700 16px system-ui;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:4px}p{min-height:20px;color:#bec1cd;font-size:13px;line-height:1.5}footer{display:flex;justify-content:space-between;align-items:center;gap:12px}a{color:#fff;font-size:13px}
</style>
<main><header><h1>ReelRelay</h1><span>Video demo</span></header>
<video id="video" controls playsinline preload="metadata"><source src="/video.mp4" type="video/mp4">Your browser cannot play this video. Download the MP4 below.</video>
<button id="play" type="button">Play with sound / 播放声音</button>
<footer><p id="status" role="status">Click Play with sound to start.</p><a href="/download.mp4" download="reelrelay-demo.mp4">Download MP4</a></footer></main>
<script>
const video=document.getElementById('video'),button=document.getElementById('play'),status=document.getElementById('status');
button.addEventListener('click',async()=>{video.muted=false;video.volume=1;if(video.ended)video.currentTime=0;try{await video.play();status.textContent='Sound is on. Adjust the volume below the video.';}catch{status.textContent='Playback was blocked. Use the video controls or download the MP4.';}});
video.addEventListener('volumechange',()=>{status.textContent=video.muted||video.volume===0?'Sound is muted. Click Play with sound.':'Sound is on.';});
video.addEventListener('error',()=>{status.textContent='This browser could not play the file. Download the MP4 and open it in a media player.';});
</script></html>`;

const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  const route = new URL(request.url ?? "/", "http://localhost").pathname;
  if (route === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.method === "HEAD" ? undefined : html);
    return;
  }
  if (route !== "/video.mp4" && route !== "/download.mp4") { response.writeHead(404); response.end(); return; }
  response.setHeader("Content-Type", "video/mp4");
  response.setHeader("Accept-Ranges", "bytes");
  if (route === "/download.mp4") response.setHeader("Content-Disposition", 'attachment; filename="reelrelay-demo.mp4"');
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
  const stream = createReadStream(videoPath, { start, end });
  stream.on("error", () => response.destroy());
  response.on("close", () => stream.destroy());
  stream.pipe(response);
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.info(`Watch with sound: http://localhost:${port}\nVideo: ${videoPath}`));
