import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { gameplays, gameplayIds } from "../packages/reel/src/gameplays.js";
import { playerPage, type DemoVideo } from "./demo-player/page.js";

const { values } = parseArgs({
  args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
  options: { file: { type: "string" }, port: { type: "string", default: "4010" } },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Choose a port from 1 to 65535.");
const candidates: DemoVideo[] = values.file
  ? [{ id: "custom", label: "Selected video", filePath: path.resolve(values.file) }]
  : gameplayIds.map((id) => ({ id, label: gameplays[id].label, creator: gameplays[id].creator, sourceUrl: gameplays[id].sourceUrl, license: gameplays[id].license, filePath: path.resolve("build/demo", `professor_deadline${id === "subway-surfers" ? "" : `.${id}`}.mp4`) }));
const videos = (await Promise.all(candidates.map(async (video) => {
  const info = await stat(video.filePath).catch(() => null);
  return info?.isFile() && info.size > 0 && path.extname(video.filePath).toLowerCase() === ".mp4" ? video : null;
}))).filter((video): video is DemoVideo => video !== null);
const firstVideo = videos[0];
if (!firstVideo) throw new Error("No demo MP4 found. Run pnpm reel:render first, or pass --file path/to/video.mp4.");

const playerDirectory = fileURLToPath(new URL("./demo-player/", import.meta.url));
const assetFiles = [
  { name: "player.css", file: "player.css", contentType: "text/css; charset=utf-8" },
  { name: "player.js", file: "player.js", contentType: "text/javascript; charset=utf-8" },
  ...gameplayIds.flatMap((id) => [id, `${id}-poster`].map((name) => ({ name: `${name}.jpg`, file: `assets/${name}.jpg`, contentType: "image/jpeg" }))),
];
const assets = new Map<string, { body: Buffer; contentType: string }>(await Promise.all(assetFiles.map(async (asset) => [
  `/assets/${asset.name}`,
  { body: await readFile(path.join(playerDirectory, asset.file)), contentType: asset.contentType },
] as const)));

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
    const url = new URL(request.url ?? "/", "http://localhost");
    const asset = assets.get(url.pathname);
    if (asset) {
      response.setHeader("Content-Type", asset.contentType);
      response.setHeader("Content-Length", asset.body.length);
      response.end(request.method === "HEAD" ? undefined : asset.body);
      return;
    }
    const id = url.searchParams.get("background");
    const selected = id ? videos.find((video) => video.id === id) : firstVideo;
    if (!selected) { response.writeHead(404); response.end("Unknown background."); return; }
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : playerPage(videos, selected));
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
