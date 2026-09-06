import { searchWeb } from "../services/webSearch.js";
import { askForJson } from "../services/llm.js";
import type { ResearchDossier, SourcedFact, TrendCandidate } from "../types.js";

/**
 * This is the most important agent in the pipeline. It NEVER lets the LLM
 * assert a fact from memory — every claim must trace back to a real search
 * result with a URL. That URL later goes into the video description, which
 * is both good practice and your best defense against "low-value/AI slop"
 * demonetization review.
 */
export async function buildResearchDossier(candidate: TrendCandidate): Promise<ResearchDossier> {
  const hits = await searchWeb(`${candidate.topic} facts documented evidence`, 8);

  if (hits.length < 3) {
    throw new Error(
      `Not enough credible sources found for "${candidate.topic}" — skipping rather than inventing facts.`
    );
  }

  const facts = await askForJson<SourcedFact[]>(
    `You extract only claims that are EXPLICITLY stated in the provided source snippets.
     Never add outside knowledge. Never infer beyond what's written. If a snippet is thin,
     extract fewer facts rather than padding. Return ONLY a JSON array of 6-10 objects:
     {claim, sourceUrl, sourceTitle, publishedDate?}. Each "claim" must be a single, concrete,
     checkable sentence, and "sourceUrl" must be copied exactly from the matching source.`,
    `Topic: ${candidate.topic}\nAngle: ${candidate.angle}\n\nSources:\n${hits
      .map((h, i) => `[${i}] ${h.title} — ${h.url}\n${h.content}`)
      .join("\n\n")}`
  );

  // Guard: drop any "fact" whose URL wasn't actually in our source set (catches LLM drift).
  const validUrls = new Set(hits.map((h) => h.url));
  const verifiedFacts = facts.filter((f) => validUrls.has(f.sourceUrl));

  if (verifiedFacts.length < 3) {
    throw new Error(`Too few verifiable facts survived for "${candidate.topic}" — skipping.`);
  }

  const summary = verifiedFacts.map((f) => f.claim).join(" ");
  return { topic: candidate.topic, angle: candidate.angle, facts: verifiedFacts, summary };
}
