import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = fileURLToPath(new URL("../packages/reel/public/fonts/", import.meta.url));
await mkdir(directory, { recursive: true });
const files = [
  ["NotoSansSC-Bold.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"],
  ["NotoSans-Bold.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf"],
  ["NotoSansKR-Bold.ttf", "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf"],
  ["OFL-NotoSansSC.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt"],
  ["OFL-NotoSans.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/OFL.txt"],
  ["OFL-NotoSansKR.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/OFL.txt"],
];
for (const [name, url] of files) {
  const target = path.join(directory, name);
  try { await access(target); continue; } catch { /* Download only missing assets. */ }
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Could not download ${name}: HTTP ${response.status}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  console.info(`Downloaded ${name}`);
}
