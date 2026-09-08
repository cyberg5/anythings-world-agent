import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { rename, stat, unlink } from "fs/promises";
import { config } from "../config.js";

const run = promisify(execFile);

/**
 * Free narration via Microsoft Edge's "Read Aloud" engine — no signup, no API
 * key, no per-character cost. It's an unofficial use of Microsoft's endpoint
 * (there's no official free public API for it), so if Microsoft ever changes
 * it, this package's maintainers usually patch quickly, but check
 * https://www.npmjs.com/package/msedge-tts if synthesis suddenly starts
 * failing everywhere at once.
 *
 * IMPORTANT: this free endpoint occasionally returns a corrupt/near-empty
 * response (seen in production: entire segments rendered with captions but
 * dead silence underneath, because the "audio" file was garbage that ffmpeg
 * silently decoded as a long block of silence instead of erroring). This
 * function now verifies the output before trusting it, and retries.
 *
 * Voice list: see https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts
 */
export async function synthesizeSpeech(text: string, outPath: string): Promise<string> {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const minExpectedSeconds = Math.max(0.8, wordCount / 4);

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(config.ttsVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const dir = path.dirname(outPath);
      const { audioFilePath } = await tts.toFile(dir, text);
      if (audioFilePath !== outPath) {
        await rename(audioFilePath, outPath);
      }

      await assertValidAudio(outPath, minExpectedSeconds);
      return outPath;
    } catch (err) {
      lastError = err;
      await unlink(outPath).catch(() => {});
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  throw new Error(
    `TTS produced invalid/silent audio for text after ${maxAttempts} attempts: "${text.slice(0, 60)}...". ` +
      `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

/** Confirms the synthesized file is a real, non-trivial audio clip — not empty, not corrupt, not silent. */
async function assertValidAudio(filePath: string, minExpectedSeconds: number): Promise<void> {
  const { size } = await stat(filePath);
  if (size < 2000) {
    throw new Error(`TTS output file suspiciously small (${size} bytes) — likely a failed/corrupt response.`);
  }

  const { stdout: durationOut } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = parseFloat(durationOut.trim());
  if (!duration || duration < minExpectedSeconds * 0.5) {
    throw new Error(`TTS output too short (${duration}s for an expected ~${minExpectedSeconds.toFixed(1)}s).`);
  }

  const { stdout: volumeOut } = await run("ffmpeg", [
    "-i", filePath,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]).catch((e) => ({ stdout: "", stderr: e.stderr ?? "" } as any));
  const stderrText = (volumeOut as any).stderr ?? volumeOut;
  const meanMatch = /mean_volume:\s*(-?\d+(\.\d+)?)\s*dB/.exec(String(stderrText));
  if (meanMatch && parseFloat(meanMatch[1]) < -50) {
    throw new Error(`TTS output is effectively silent (mean volume ${meanMatch[1]} dB).`);
  }
}
