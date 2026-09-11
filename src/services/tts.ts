import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { stat, unlink } from "fs/promises";
import os from "os";
import path from "path";
import { config } from "../config.js";

const run = promisify(execFile);

const PIPER_DATA_DIR = path.join(os.homedir(), ".local", "share", "piper-voices");

export async function synthesizeSpeech(text: string, outPath: string): Promise<string> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runPiper(text, outPath);
      await assertValidAudio(outPath, text);
      return outPath;
    } catch (err) {
      lastError = err;
      await unlink(outPath).catch(() => {});
    }
  }

  throw new Error(
    `Piper produced invalid/silent audio for text after ${maxAttempts} attempts: "${text.slice(0, 60)}...". ` +
      `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
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

async function assertValidAudio(filePath: string, text: string): Promise<void> {
  const { size } = await stat(filePath);
  if (size < 500) {
    throw new Error(`TTS output file suspiciously small (${size} bytes) for text: "${text.slice(0, 60)}..."`);
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
    throw new Error(`TTS output too short (${duration}s for an expected ~${minExpectedSeconds.toFixed(1)}s).`);
  }

  const volumeResult = await run("ffmpeg", ["-i", filePath, "-af", "volumedetect", "-f", "null", "-"]).catch(
    (e) => ({ stdout: "", stderr: e.stderr ?? "" })
  );
  const stderrText = String((volumeResult as any).stderr ?? "");
  const meanMatch = /mean_volume:\s*(-?\d+(\.\d+)?)\s*dB/.exec(stderrText);
  if (meanMatch && parseFloat(meanMatch[1]) < -50) {
    throw new Error(`TTS output is effectively silent (mean volume ${meanMatch[1]} dB).`);
  }
}
