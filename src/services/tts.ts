import { spawn } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import { config } from "../config.js";

const run = promisify(execFile);

/**
 * Narration via Piper (https://github.com/rhasspy/piper) — a fully local,
 * offline neural TTS engine. No API key, no account, no billing, no card,
 * and no dependency on any hosted service being reachable/unblocked for you
 * at synthesis time: the `piper` binary and voice model run entirely inside
 * the GitHub Actions runner. This replaced two earlier attempts:
 *   - msedge-tts (unofficial, occasionally returned corrupt/silent audio)
 *   - Google Cloud TTS (official, but requires a billing account with an
 *     internationally-chargeable card, which isn't available to everyone)
 *
 * Setup: `pip install piper-tts` (see .github/workflows/daily-run.yml) — the
 * first run downloads the ~60MB voice model automatically from Hugging Face
 * and caches it; every run after that reuses the cached copy for that CI run.
 *
 * TTS_VOICE in .env should be a Piper voice name, e.g. "en_US-lessac-medium".
 * Full voice list: https://github.com/rhasspy/piper/blob/master/VOICES.md
 */
export async function synthesizeSpeech(text: string, outPath: string): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("piper", ["--model", config.ttsVoice, "--output_file", outPath]);

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited with code ${code}: ${stderr}`));
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });

  await assertValidAudio(outPath, text);
  return outPath;
}

/** Confirms the synthesized file is a real, non-trivial audio clip. */
async function assertValidAudio(filePath: string, text: string): Promise<void> {
  const { size } = await stat(filePath);
  if (size < 500) {
    throw new Error(`TTS output file suspiciously small (${size} bytes) for text: "${text.slice(0, 60)}..."`);
  }

  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = parseFloat(stdout.trim());
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const minExpectedSeconds = Math.max(0.5, wordCount / 5);
  if (!duration || duration < minExpectedSeconds * 0.5) {
    throw new Error(`TTS output too short (${duration}s for an expected ~${minExpectedSeconds.toFixed(1)}s).`);
  }
}
