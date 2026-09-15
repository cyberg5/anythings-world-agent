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

  const sourceList = dossier.facts
    .map((f) => `• ${f.claim}\n  ${f.sourceUrl}`)
    .join("\n");

  const shortsTag = isLong ? "" : " #Shorts";
  const description =
    `${raw.hookLine}\n\n` +
    `This video is scripted and narrated with AI assistance, based on the sources below.\n\n` +
    `Sources:\n${sourceList}\n\n` +
    `${shortsTag} #${config.channelName.replace(/[^a-zA-Z0-9]/g, "")}`;

  // The free LLM frequently ignores the segment-count instruction above and
  // writes way more than asked — two production runs in a row got rejected
  // by QA for running 2-3x over the target length, burning whole attempts.
  // Enforce a hard cap here instead of just hoping the prompt is followed:
  // trim to the first N segments (keeping the story coherent) plus the
  // final segment (always the call-to-action, however far in it was).
  const maxSegments = isLong ? 36 : 12;
  let narrationSegments = raw.narrationSegments;
  if (narrationSegments.length > maxSegments) {
    const kept = narrationSegments.slice(0, maxSegments - 1);
    const cta = narrationSegments[narrationSegments.length - 1];
    narrationSegments = [...kept, cta];
  }

  return { ...raw, narrationSegments, format: dossier.format, citedSources: dossier.facts, description };
}
