import { askForJson } from "../services/llm.js";
import { searchWeb } from "../services/webSearch.js";
import { getTopPerformingTopics, isTopicAlreadyUsed } from "../services/supabase.js";
import type { TrendCandidate } from "../types.js";

/**
 * Finds a topic for the next video. Deliberately pulls only a *topic/angle*
 * signal from trending searches — never a script, never another creator's
 * wording — so nothing here can turn into copied content.
 */
export async function pickNextTopic(): Promise<TrendCandidate> {
  const [wellKnownWins, generalTrendHits] = await Promise.all([
    getTopPerformingTopics(8),
    searchWeb("viral educational short video ideas trending this week", 8),
  ]);

  const candidates = await askForJson<TrendCandidate[]>(
    `You generate topic ideas for a documentary-style, fact-based Shorts channel called
     "AnyThings World". Topics must be about REAL, verifiable, interesting subjects
     (history, science, unexplained events, technology, nature) — never celebrity gossip,
     never anything requiring speculation presented as fact.
     Optimize for RETENTION, not just accuracy: favor topics with a genuine "wait, what?"
     moment, an unresolved mystery, a myth-vs-truth angle, or a surprising twist that a
     factual, well-sourced story can pay off over ~90 seconds. Avoid dry, purely
     encyclopedic topics with no narrative hook, even if technically interesting.
     Return ONLY a JSON array of 3 objects: {topic, angle, reasonScore (0-1), sourceChannelContext}.
     "angle" should name the specific hook/mystery/twist the script will build around.`,
    `Previously well-performing topics on this channel: ${JSON.stringify(wellKnownWins)}.
     Current general trend signals (titles/snippets only, for topic inspiration — do not
     reuse their wording): ${JSON.stringify(generalTrendHits.map((h) => h.title))}.
     Propose 3 fresh topic candidates, ranked best first.`
  );

  for (const c of candidates) {
    if (!(await isTopicAlreadyUsed(c.topic))) return c;
  }
  // Fallback: force a novel angle if everything collided with history.
  return { ...candidates[0], topic: `${candidates[0].topic} (new angle)` };
}
