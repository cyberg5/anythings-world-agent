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
  const isLong = candidate.format === "long";
  const searchCount = isLong ? 18 : 12;
  const factRange = isLong ? "25-35" : "12-18";
  const minFacts = isLong ? 18 : 8;

  const hits = await searchWeb(`${candidate.topic} facts documented evidence`, searchCount);

  if (hits.length < 3) {
    throw new Error(
      `Not enough credible sources found for "${candidate.topic}" — skipping rather than inventing facts.`
    );
  }

  const facts = await askForJson<SourcedFact[]>(
    `You extract only claims that are EXPLICITLY stated in the provided source snippets.
     Never add outside knowledge. Never infer beyond what's written. If a snippet is thin,
     extract fewer facts rather than padding. Return ONLY a JSON array of ${factRange} objects:
     {claim, sourceUrl, sourceTitle, publishedDate?}. Each "claim" must be a single, concrete,
     checkable sentence, and "sourceUrl" must be copied exactly from the matching source.
     Prefer claims with concrete, surprising, or story-worthy detail (numbers, firsts,
     turning points, contradictions) over generic background — this feeds a script that
     needs to hold a viewer's attention, not just list facts.`,
    `Topic: ${candidate.topic}\nAngle: ${candidate.angle}\n\nSources:\n${hits
      .map((h, i) => `[${i}] ${h.title} — ${h.url}\n${h.content}`)
      .join("\n\n")}`
  );

  // Guard: drop any "fact" whose URL wasn't actually in our source set (catches LLM drift).
  const validUrls = new Set(hits.map((h) => h.url));
  const verifiedFacts = facts.filter((f) => validUrls.has(f.sourceUrl));

  if (verifiedFacts.length < minFacts) {
    throw new Error(
      `Only ${verifiedFacts.length} verifiable facts survived for "${candidate.topic}" — not enough ` +
        `for a full-length script, skipping rather than padding with weak/repetitive content.`
    );
  }

  const summary = verifiedFacts.map((f) => f.claim).join(" ");
  return { topic: candidate.topic, angle: candidate.angle, format: candidate.format, facts: verifiedFacts, summary };
}
