import { askForJson } from "../services/llm.js";
import { config } from "../config.js";
import type { ResearchDossier, VideoScript } from "../types.js";

export async function writeScript(dossier: ResearchDossier): Promise<VideoScript> {
  const raw = await askForJson<Omit<VideoScript, "citedSources" | "description">>(
    `You write scripts for "${config.channelName}", a documentary-style Shorts channel that
     wins on RETENTION and ENGAGEMENT, not just information — the goal is viewers watching to
     the end, liking, commenting, and subscribing, the way top-performing YouTube Shorts do.
     Every claim must still be traceable ONLY to the provided facts — never invent claims,
     numbers, dates, or quotes — but HOW you tell it should feel like a gripping mini-story,
     not a Wikipedia summary read aloud.

     Structure (~80-100 seconds of narration total, aim for the higher end):
     - hookLine: the first ~3 seconds. Open a curiosity gap or make a bold, surprising claim
       that the rest of the video pays off — "Everyone believes X. They're wrong." /
       "This shouldn't be possible, but it happened." Never a bland topic announcement.
     - narrationSegments: 10-16 segments, each {text, visualQuery, approxSeconds ~6-9}.
       - Escalate: each segment should raise the stakes or deepen the mystery before
         resolving it — plant a question early, answer it later.
       - Around the middle, include one short "re-hook" line that pulls a wavering viewer
         back in (e.g. "But here's where it gets stranger:").
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

  const description =
    `${raw.hookLine}\n\n` +
    `This video is scripted and narrated with AI assistance, based on the sources below.\n\n` +
    `Sources:\n${sourceList}\n\n` +
    `#Shorts #${config.channelName.replace(/[^a-zA-Z0-9]/g, "")}`;

  return { ...raw, citedSources: dossier.facts, description };
}
