import { askForJson } from "../services/llm.js";
import { config } from "../config.js";
import type { ResearchDossier, VideoScript } from "../types.js";

export async function writeScript(dossier: ResearchDossier): Promise<VideoScript> {
  const isLong = dossier.format === "long";

  // Short-form MUST stay comfortably under YouTube's 3-minute Shorts ceiling
  // (it's classified automatically by duration + vertical aspect ratio, no
  // manual flag) — targeting ~60-90s leaves a big safety margin. Long-form
  // targets a duration that's unambiguously OVER that ceiling, so it's
  // classified as a regular video instead.
  const lengthSpec = isLong
    ? `~4-5 minutes of narration total (240-300 seconds). Use 28-36 segments, each
       {text, visualQuery, approxSeconds ~7-9}.`
    : `~60-90 seconds of narration total. Use 9-12 segments, each
       {text, visualQuery, approxSeconds ~6-8}. Stay well under 3 minutes total —
       do not let this run long.`;

  const raw = await askForJson<Omit<VideoScript, "citedSources" | "description" | "format">>(
    `You write scripts for "${config.channelName}", a documentary-style channel that wins on
     RETENTION and ENGAGEMENT, not just information — the goal is viewers watching to the end,
     liking, commenting, and subscribing, the way top-performing YouTube channels do.
     Every claim must still be traceable ONLY to the provided facts — never invent claims,
     numbers, dates, or quotes — but HOW you tell it should feel like a gripping mini-story,
     not a Wikipedia summary read aloud.

     Structure (${lengthSpec}):
     - hookLine: the first ~3 seconds. Open a curiosity gap or make a bold, surprising claim
       that the rest of the video pays off — "Everyone believes X. They're wrong." /
       "This shouldn't be possible, but it happened." Never a bland topic announcement.
     - narrationSegments:
       - Escalate: each segment should raise the stakes or deepen the mystery before
         resolving it — plant a question early, answer it later.
       - Include at least one short "re-hook" line partway through that pulls a wavering
         viewer back in (e.g. "But here's where it gets stranger:") — for the long-form
         length, space 2-3 of these through the video, roughly every minute.
       - Vary sentence rhythm — mix short punchy lines with longer explanatory ones. Avoid
         a flat, dry, textbook tone throughout.
       - visualQuery: a short phrase describing real footage/imagery for that segment (for
         stock video/photo search) — concrete and visual, not abstract.
     - The FINAL segment must be a direct, natural call-to-action tied to the story just
       told (not generic) — e.g. inviting the viewer to say what they think in the comments,
       or follow for the next one — because this is what actually drives likes/comments/subs.
     - onScreenTitle: short, curiosity-driven, under 60 characters — a real hook, not a label.
     - tags: 8-12 relevant search tags.
     Return ONLY JSON matching: {hookLine, narrationSegments, onScreenTitle, tags, topic}.`,
    `Topic: ${dossier.topic}\nAngle: ${dossier.angle}\n\nVerified facts you may draw from:\n${dossier.facts
      .map((f, i) => `${i + 1}. ${f.claim} (source: ${f.sourceUrl})`)
      .join("\n")}`
  );

  const shortsTag = isLong ? "" : " #Shorts";
  const header = `${raw.hookLine}\n\nThis video is scripted and narrated with AI assistance, based on the sources below.\n\nSources:\n`;
  const footer = `\n\n${shortsTag} #${config.channelName.replace(/[^a-zA-Z0-9]/g, "")}`;

  // YouTube rejects uploads with "invalid video description" once it's too
  // long (~5000 chars) — a real incident: a 30+-fact long-form script's full
  // source list pushed the description over that limit and failed at upload,
  // after the whole video had already been rendered. Build the source list
  // fact-by-fact and stop before crossing a safe budget, rather than always
  // including every source and finding out too late.
  const budget = 4700 - header.length - footer.length;
  let sourceList = "";
  let includedCount = 0;
  for (const f of dossier.facts) {
    const line = `• ${f.claim}\n  ${f.sourceUrl}\n`;
    if (sourceList.length + line.length > budget) break;
    sourceList += line;
    includedCount++;
  }
  const omitted = dossier.facts.length - includedCount;
  if (omitted > 0) sourceList += `(+${omitted} more source${omitted === 1 ? "" : "s"})`;

  const description = `${header}${sourceList.trimEnd()}${footer}`;

  // The free LLM frequently ignores the segment-count/length instruction
  // above and writes way more than asked. A flat segment-COUNT cap wasn't
  // enough on its own — 12 segments at ~20s each still blows past the 170s
  // short-form ceiling. Trim by CUMULATIVE estimated duration instead, and
  // always keep the final segment (the call-to-action), whatever's left of
  // the budget for it.
  const durationBudget = isLong ? 260 : 75; // seconds; deliberately under the QA ceiling —
  // real narration routinely runs longer than the LLM's own approxSeconds guess.
  const maxSegments = isLong ? 36 : 12;

  let narrationSegments = raw.narrationSegments;
  if (narrationSegments.length > 1) {
    const cta = narrationSegments[narrationSegments.length - 1];
    const body = narrationSegments.slice(0, -1);

    const kept: typeof body = [];
    let runningTotal = 0;
    for (const seg of body) {
      if (kept.length >= maxSegments - 1) break;
      if (runningTotal + seg.approxSeconds > durationBudget) break;
      kept.push(seg);
      runningTotal += seg.approxSeconds;
    }
    // Always keep at least a couple of body segments even if the very first
    // one alone somehow blew the budget — an empty/near-empty story is worse
    // than a slightly-over-budget one QA can still catch downstream.
    narrationSegments = [...(kept.length > 0 ? kept : body.slice(0, 2)), cta];
  }

  return { ...raw, narrationSegments, format: dossier.format, citedSources: dossier.facts, description };
}
