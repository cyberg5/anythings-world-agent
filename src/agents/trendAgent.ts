import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { askForJson } from "../services/llm.js";
import { searchWeb } from "../services/webSearch.js";
import { getTopPerformingTopics, isTopicAlreadyUsed } from "../services/supabase.js";
import type { TrendCandidate, VideoFormat } from "../types.js";

/**
 * Operator-supplied topic ideas, managed from the CYE mobile app. The app
 * writes this file to the repo via the GitHub Contents API; we read it here
 * and give these topics priority over auto-generated ones. Missing/invalid
 * file is fine — we just fall back to normal topic generation.
 */
function loadCustomTopics(): string[] {
  try {
    const p = path.resolve(config.customTopicsFile); // one file per platform
    if (!fs.existsSync(p)) return [];
    const arr = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Array.isArray(arr) ? arr.filter((t) => typeof t === "string" && t.trim()) : [];
  } catch {
    return [];
  }
}

/**
 * Finds a topic for the next video. Deliberately pulls only a *topic/angle*
 * signal from trending searches — never a script, never another creator's
 * wording — so nothing here can turn into copied content.
 */
export async function pickNextTopic(format: VideoFormat): Promise<TrendCandidate> {
  const lengthNote =
    format === "long"
      ? "This one is LONG-FORM (~4-5 minutes) — pick a topic with enough real depth and " +
        "multiple layers/twists to sustain that, not just a single quick fact."
      : "This one is SHORT-FORM (~60-90 seconds) — pick a topic that pays off fast.";

  // 1) Operator-chosen topics (from the CYE app) take priority. Use the first
  //    one that hasn't been made yet, and have the LLM craft a strong angle
  //    for that EXACT topic (the topic itself is never changed).
  const customTopics = loadCustomTopics();
  for (const topic of customTopics) {
    if (await isTopicAlreadyUsed(topic)) continue;
    const crafted = await askForJson<Omit<TrendCandidate, "format">>(
      `You craft a documentary-style angle for a fact-based channel called "AnyThings World".
       You are given ONE exact topic chosen by the channel operator — do NOT change the topic,
       only design the most gripping, real, sourceable angle/hook for it. ${lengthNote}
       Return ONLY a JSON object: {topic, angle, reasonScore (0-1), sourceChannelContext}.
       Keep "topic" EXACTLY as provided.`,
      `Operator-chosen topic: ${topic}`
    );
    return { ...crafted, topic, format };
  }

  const [wellKnownWins, generalTrendHits] = await Promise.all([
    getTopPerformingTopics(8),
    searchWeb("viral educational short video ideas trending this week", 8),
  ]);

  const candidates = await askForJson<Omit<TrendCandidate, "format">[]>(
    `You generate topic ideas for a documentary-style, fact-based Shorts/videos channel called
     "AnyThings World". Topics must be about REAL, verifiable, interesting subjects — never
     celebrity gossip, never anything requiring speculation presented as fact.
     Research on what actually retains viewers in this format points strongly toward:
     unsolved mysteries and unexplained-but-documented phenomena, myth-vs-truth reveals,
     and mind-blowing science/space facts — these consistently outperform dry encyclopedic
     topics. Default toward these unless a clearly stronger real-and-sourceable angle exists.
     ${lengthNote}
     Return ONLY a JSON array of 3 objects: {topic, angle, reasonScore (0-1), sourceChannelContext}.
     "angle" should name the specific hook/mystery/twist the script will build around.`,
    `Previously well-performing topics on this channel: ${JSON.stringify(wellKnownWins)}.
     Current general trend signals (titles/snippets only, for topic inspiration — do not
     reuse their wording): ${JSON.stringify(generalTrendHits.map((h) => h.title))}.
     Propose 3 fresh topic candidates, ranked best first.`
  );

  for (const c of candidates) {
    if (!(await isTopicAlreadyUsed(c.topic))) return { ...c, format };
  }
  // Fallback: force a novel angle if everything collided with history.
  return { ...candidates[0], format, topic: `${candidates[0].topic} (new angle)` };
}
