import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OPTIMIZE_THRESHOLD_BYTES, optimizeForTelegram } from "../src/delivery/telegram/optimize.js";

async function tempFile(name: string, bytes: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelrelay-opt-"));
  const file = path.join(dir, name);
  await writeFile(file, Buffer.alloc(bytes, 1));
  return file;
}

describe("reel optimization before Telegram upload", () => {
  it("leaves a small video alone rather than paying for a second encode", async () => {
    const file = await tempFile("small.mp4", 1024);
    const result = await optimizeForTelegram(file);
    expect(result.skipped).toBe("below_threshold");
    expect(result.path).toBe(file);
    expect(result.isTemporary).toBe(false);
    expect(result.bytes).toBe(1024);
  });

  it("keeps the original when the input is not decodable, so delivery still happens", async () => {
    // Over the threshold, so a re-encode is attempted; ffmpeg rejects the zero-filled bytes.
    const file = await tempFile("garbage.mp4", OPTIMIZE_THRESHOLD_BYTES + 1024);
    const result = await optimizeForTelegram(file);
    expect(result.path).toBe(file);
    expect(result.isTemporary).toBe(false);
    expect(["encode_failed", "ffmpeg_missing", "probe_failed"]).toContain(result.skipped);
    // The caller must still have a readable file to upload.
    await expect(stat(result.path)).resolves.toBeTruthy();
  });

  it("reports a missing input as a skip instead of throwing", async () => {
    const result = await optimizeForTelegram("/nonexistent/path/reel.mp4");
    expect(result.skipped).toBe("encode_failed");
    expect(result.isTemporary).toBe(false);
  });
});
