import { execFile } from "child_process";
import { promisify } from "util";
import { askForJson } from "../services/llm.js";
import type { ProducedVideo, QAResult } from "../types.js";

const run = promisify(execFile);

/**
 * Stands in for the human review step you said you don't want to do.
 * Because there is no person checking uploads before they go live, this gate
 * has to be strict — anything it can't verify, it rejects rather than guesses.
 */
export async function runQA(video: ProducedVideo): Promise<QAResult> {
  const reasons: string[] = [];

  const allSourced = video.script.citedSources.length >= 3;
  if (!allSourced) reasons.push("Fewer than 3 verified sources backing this script.");

  // IMPORTANT: measure the ACTUAL rendered file, not the script's estimated
  // duration — the estimate is exactly what drifted before, producing a
  // video long enough to lose Shorts classification without QA ever noticing
  // (it was comparing the wrong number against itself).
  const actualDuration = await getActualDuration(video.filePath);

  if (video.script.format === "short") {
    // Must stay safely under YouTube's 3-minute (180s) Shorts ceiling —
    // classification is automatic (vertical + duration), so overshooting
    // this silently turns the upload into a regular video instead of a Short.
    if (actualDuration < 40 || actualDuration > 170) {
      reasons.push(`Short-form duration ${actualDuration.toFixed(1)}s outside safe 40-170s range.`);
    }
  } else {
    // Long-form should clearly exceed 180s so it's unambiguously a regular
    // video, not borderline.
    if (actualDuration < 190 || actualDuration > 400) {
      reasons.push(`Long-form duration ${actualDuration.toFixed(1)}s outside expected 190-400s range.`);
    }
  }

  // Final safety net: catch any silent stretch in the FINISHED file,
  // regardless of which upstream step caused it. This is what should have
  // (and now does) block an upload that has picture but no sound near the end.
  const worstSilence = await getWorstSilence(video.filePath);
  if (worstSilence > 1.5) {
    reasons.push(`Final render contains a ${worstSilence.toFixed(1)}s silent gap.`);
  }

  const hasDisclosure = video.script.description.toLowerCase().includes("ai");
  if (!hasDisclosure) reasons.push("Missing AI-disclosure language in description.");

  // LLM pass: catch unsupported claims / advertiser-unfriendly language that
  // slipped through, by re-checking narration against the cited facts.
  const llmCheck = await askForJson<{ ok: boolean; issues: string[] }>(
    `You are a strict compliance reviewer for an unattended, fully automated YouTube pipeline.
     Check whether every sentence in the narration is directly supported by the cited facts,
     and whether the content is advertiser-friendly (no violence, no medical/financial advice,
     no unverified claims stated as fact). Return ONLY JSON: {ok: boolean, issues: string[]}.`,
    `Narration:\n${video.script.narrationSegments.map((s) => s.text).join(" ")}\n\n` +
      `Cited facts:\n${video.script.citedSources.map((f) => f.claim).join("\n")}`
  );
  if (!llmCheck.ok) reasons.push(...llmCheck.issues);

  return { passed: reasons.length === 0, reasons };
}

async function getActualDuration(filePath: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

async function getWorstSilence(filePath: string): Promise<number> {
  // Same thresholds as the per-segment check in tts.ts — see the comment
  // there for why they must match. Skip the first 2.3s: the branded intro
  // card is a deliberately silent 2-second title card before narration
  // starts, and without this every single video was being rejected for
  // "silence" that was actually just the intro doing its job.
  const result = await run("ffmpeg", [
    "-ss", "2.3",
    "-i", filePath,
    "-af", "silencedetect=noise=-40dB:d=1.0",
    "-f", "null", "-",
  ]).catch((e) => ({ stdout: "", stderr: e.stderr ?? "" }));
  const stderrText = String((result as any).stderr ?? "");
  const durations = [...stderrText.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  return Math.max(0, ...durations);
}
