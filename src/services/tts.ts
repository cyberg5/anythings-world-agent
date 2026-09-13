import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { stat, unlink } from "fs/promises";
import os from "os";
import path from "path";
import { config } from "../config.js";

const run = promisify(execFile);

const PIPER_DATA_DIR = path.join(os.homedir(), ".local", "share", "piper-voices");

/**
 * Narration via Piper (https://github.com/rhasspy/piper) — local, offline,
 * free TTS. No API key, no billing, no card.
 *
 * IMPORTANT: Piper is deterministic — the same text reliably produces the
 * same audio. So when synthesis produces bad audio (silent patches, garbled
 * output), simply retrying the SAME text is close to useless; it tends to
 * fail the same way every time. Instead of retrying Piper itself, this
 * throws immediately on a bad result so the whole video attempt fails and
 * the orchestrator picks a fresh topic/script next attempt — different text
 * for Piper to work with, actually breaking the failure loop.
 *
 * Validation now uses silencedetect (not just an overall average volume)
 * so it also catches a long silent patch INSIDE an otherwise-normal clip —
 * an average-volume check can miss that if the rest of the clip is loud
 * enough to pull the mean up.
 */
export async function synthesizeSpeech(text: string, outPath: string): Promise<string> {
  try {
    await runPiper(text, outPath);
    await assertValidAudio(outPath, text);
    return outPath;
  } catch (err) {
    await unlink(outPath).catch(() => {});
    throw new Error(
      `Piper produced invalid audio for text: "${text.slice(0, 60)}...". ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function runPiper(text: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("piper", [
      "--model", config.ttsVoice,
      "--data-dir", PIPER_DATA_DIR,
      "--output_file", outPath,
    ]);

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
}

/** Confirms the synthesized file is a real, non-trivial, fully-audible clip. */
async function assertValidAudio(filePath: string, text: string): Promise<void> {
  const { size } = await stat(filePath);
  if (size < 500) {
    throw new Error(`Output file suspiciously small (${size} bytes).`);
  }

  const { stdout: durationOut } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = parseFloat(durationOut.trim());
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const minExpectedSeconds = Math.max(0.5, wordCount / 5);
  if (!duration || duration < minExpectedSeconds * 0.5) {
    throw new Error(`Output too short (${duration}s for an expected ~${minExpectedSeconds.toFixed(1)}s).`);
  }
  // Real production bug: Piper occasionally produced a wildly-too-long file
  // for a short line of text (one case: ~3500 seconds for a single caption) —
  // that then made "-stream_loop -1 ... -shortest" in template.ts stretch
  // the whole segment's video to match it. Cap how long is plausible for the
  // actual amount of text.
  const maxExpectedSeconds = Math.max(15, wordCount / 1.5);
  if (duration > maxExpectedSeconds) {
    throw new Error(
      `Output suspiciously long (${duration.toFixed(1)}s for only ${wordCount} words, expected ` +
        `under ~${maxExpectedSeconds.toFixed(1)}s) — likely a synthesis glitch.`
    );
  }

  // silencedetect finds every silent stretch, not just the clip's average
  // loudness — catches a dead patch in the middle of otherwise-fine speech.
  // Thresholds here MUST match the final-render check in qaAgent.ts — they
  // used to differ (-35dB here vs -40dB there), which let a borderline gap
  // pass this per-segment check but still get flagged (and correctly
  // rejected) later, wasting a full attempt. Same numbers now, so a bad
  // segment is caught immediately instead of surviving to the final QA pass.
  const result = await run("ffmpeg", [
    "-i", filePath,
    "-af", "silencedetect=noise=-40dB:d=1.0",
    "-f", "null", "-",
  ]).catch((e) => ({ stdout: "", stderr: e.stderr ?? "" }));
  const stderrText = String((result as any).stderr ?? "");

  const silenceDurations = [...stderrText.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) =>
    parseFloat(m[1])
  );
  const worstSilence = Math.max(0, ...silenceDurations);
  // A gap over ~1.5s inside a single short narration line is not a natural
  // speech pause — it's the "dead audio" bug.
  if (worstSilence > 1.5) {
    throw new Error(`Output contains a ${worstSilence.toFixed(1)}s silent gap — likely broken synthesis.`);
  }
}
