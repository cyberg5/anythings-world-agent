import { askForJson } from "../services/llm.js";
import { config } from "../config.js";
import type { ResearchDossier, VideoScript } from "../types.js";

export async function writeScript(dossier: ResearchDossier): Promise<VideoScript> {
  const raw = await askForJson<Omit<VideoScript, "citedSources" | "description">>(
    `You write scripts for "${config.channelName}", a documentary-style Shorts channel.
     Rules:
     - Every sentence in narrationSegments must be traceable to one of the provided facts —
       do not add unsupported claims, dates, numbers, or quotes.
     - hookLine: a single punchy sentence for the first ~3 seconds.
     - narrationSegments: 5-8 segments, each with {text, visualQuery, approxSeconds}.
       visualQuery is a short phrase describing real footage/imagery that would illustrate
       that segment (for stock photo search) — not an abstract/artistic description.
     - Total approxSeconds across segments should sum to 35-55 seconds.
     - onScreenTitle: short, curiosity-driven, under 60 characters.
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
