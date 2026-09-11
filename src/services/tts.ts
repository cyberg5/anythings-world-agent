import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { stat, unlink } from "fs/promises";
import os from "os";
import path from "path";
import { config } from "../config.js";

const run = promisify(execFile);

const PIPER_DATA_DIR = path.join(os.homedir(), ".local", "share", "piper-voices");

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

  const result = await run("ffmpeg", [
    "-i", filePath,
    "-af", "silencedetect=noise=-35dB:d=1.2",
    "-f", "null", "-",
  ]).catch((e) => ({ stdout: "", stderr: e.stderr ?? "" }));
  const stderrText = String((result as any).stderr ?? "");

  const silenceDurations = [...stderrText.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) =>
    parseFloat(m[1])
  );
  const worstSilence = Math.max(0, ...silenceDurations);
  if (worstSilence > 1.5) {
    throw new Error(`Output contains a ${worstSilence.toFixed(1)}s silent gap — likely broken synthesis.`);
  }
}
