// Dev B. Shrinks a rendered reel before it goes up to Telegram.
//
// Why this exists: Remotion writes a high-bitrate 720x1280 mp4 (~9 MB for 30 s). Uploading that to the Bot API from a
// home connection stalls — an observed 9.2 MB send sat in `delivering` for ten minutes, exhausted all four worker
// retries and failed with error_code=DELIVERY. A ~2 s re-encode to under 4 MB turns that into a quick upload.
//
// Size-targeted rather than CRF-targeted: the gameplay background is high-motion, so CRF plateaus around 3.8 MB and
// the resulting size swings with content. Deriving the bitrate from the duration gives a predictable ceiling, which is
// what the upload actually cares about.
//
// Every failure path returns the ORIGINAL file: optimization is an accelerator, never a gate on delivery.
import { execFile } from "node:child_process";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

/** Above this we re-encode. Below it the upload is already quick and a second pass would only cost time. */
export const OPTIMIZE_THRESHOLD_BYTES = 4 * 1024 * 1024;
/** What we aim the re-encode at. Observed output lands a little under this. */
export const OPTIMIZE_TARGET_BYTES = 4 * 1024 * 1024;
/** Narration is speech over game audio; 96 kbps AAC is transparent enough and saves ~1 MB per minute. */
export const OPTIMIZE_AUDIO_BITRATE_BPS = 96 * 1024;
/** Re-encoding must not outlast the render it follows. */
export const OPTIMIZE_TIMEOUT_MS = 120_000;
/** Floor for the computed video bitrate: below this 720x1280 falls apart regardless of the size target. */
export const OPTIMIZE_MIN_VIDEO_BPS = 400 * 1024;

export interface OptimizeResult {
  /** The file to upload — the compressed copy, or the input when compression was skipped or unhelpful. */
  path: string;
  bytes: number;
  originalBytes: number;
  /** True when `path` is a new file the caller should delete after sending. */
  isTemporary: boolean;
  /** Why the original was kept, for the log line. Absent on a successful shrink. */
  skipped?: "below_threshold" | "ffmpeg_missing" | "probe_failed" | "encode_failed" | "no_gain";
}

function keep(input: string, bytes: number, skipped: OptimizeResult["skipped"]): OptimizeResult {
  return { path: input, bytes, originalBytes: bytes, isTemporary: false, skipped };
}

/** Duration in seconds via ffprobe, or null when it cannot be measured. */
async function durationSeconds(file: string): Promise<number | null> {
  try {
    const { stdout } = await runFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { timeout: 10_000, windowsHide: true },
    );
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/**
 * Re-encodes `input` to a smaller mp4 next to it and returns whichever file should actually be sent.
 *
 * The video bitrate is derived from the duration so the output lands near `targetBytes` whatever the content does.
 * `-movflags +faststart` moves the moov atom to the front so Telegram can stream while it downloads; `-preset veryfast`
 * keeps the pass to a couple of seconds. The caller deletes the result when `isTemporary` is set.
 */
export async function optimizeForTelegram(
  input: string,
  options: { thresholdBytes?: number; targetBytes?: number } = {},
): Promise<OptimizeResult> {
  const threshold = options.thresholdBytes ?? OPTIMIZE_THRESHOLD_BYTES;
  const target = options.targetBytes ?? OPTIMIZE_TARGET_BYTES;

  let originalBytes: number;
  try {
    originalBytes = (await stat(input)).size;
  } catch {
    return keep(input, 0, "encode_failed");
  }
  if (originalBytes <= threshold) return keep(input, originalBytes, "below_threshold");

  const seconds = await durationSeconds(input);
  if (seconds === null) return keep(input, originalBytes, "probe_failed");

  const videoBps = Math.max(OPTIMIZE_MIN_VIDEO_BPS, Math.floor((target * 8) / seconds) - OPTIMIZE_AUDIO_BITRATE_BPS);
  const output = path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.tg.mp4`);

  try {
    await runFile("ffmpeg", [
      "-v", "error", "-y",
      "-i", input,
      "-c:v", "libx264",
      "-b:v", String(videoBps),
      "-maxrate", String(Math.floor(videoBps * 1.5)),
      "-bufsize", String(videoBps * 2),
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",            // Telegram's player rejects 4:4:4 from some encoders
      "-c:a", "aac", "-b:a", String(OPTIMIZE_AUDIO_BITRATE_BPS),
      "-movflags", "+faststart",
      output,
    ], { timeout: OPTIMIZE_TIMEOUT_MS, windowsHide: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    await unlink(output).catch(() => undefined);
    return keep(input, originalBytes, code === "ENOENT" ? "ffmpeg_missing" : "encode_failed");
  }

  let bytes: number;
  try {
    bytes = (await stat(output)).size;
  } catch {
    return keep(input, originalBytes, "encode_failed");
  }
  // A re-encode that grew the file is not worth uploading over the original.
  if (bytes === 0 || bytes >= originalBytes) {
    await unlink(output).catch(() => undefined);
    return keep(input, originalBytes, "no_gain");
  }
  return { path: output, bytes, originalBytes, isTemporary: true };
}
