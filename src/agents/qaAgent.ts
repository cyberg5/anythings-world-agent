import { askForJson } from "../services/llm.js";
import type { ProducedVideo, QAResult } from "../types.js";

/**
 * Stands in for the human review step you said you don't want to do.
 * Because there is no person checking uploads before they go live, this gate
 * has to be strict — anything it can't verify, it rejects rather than guesses.
 */
export async function runQA(video: ProducedVideo): Promise<QAResult> {
  const reasons: string[] = [];

  const allSourced = video.script.citedSources.length >= 3;
  if (!allSourced) reasons.push("Fewer than 3 verified sources backing this script.");

  // YouTube Shorts allow up to 3 minutes now, so this isn't a hard platform
  // limit — it's a sanity check that the script actually hit its ~80-100s
  // target (see scriptAgent.ts) instead of being suspiciously short/long.
  const durationOk = video.durationSeconds >= 60 && video.durationSeconds <= 115;
  if (!durationOk) reasons.push(`Duration ${video.durationSeconds}s outside expected 60-115s range.`);

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
