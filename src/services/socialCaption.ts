import { config } from "../config.js";
import type { VideoScript } from "../types.js";

/**
 * Caption for TikTok / Instagram. The YouTube description (scriptAgent.ts)
 * is ~4700 chars with a full source list and #Shorts — wrong for these
 * platforms: both cap captions at 2200 characters, Instagram allows at most
 * 30 hashtags, and #Shorts is YouTube-only noise.
 *
 * Keeps the same AI disclosure and as many sources as fit, so every claim is
 * still traceable from the post itself.
 */
export function buildSocialCaption(script: VideoScript, maxHashtags: number): string {
  const MAX = 2200;

  const tagWords = script.tags
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length > 1);
  const channelTag = config.channelName.replace(/[^a-zA-Z0-9]/g, "");
  const hashtags = [...new Set([channelTag, ...tagWords])]
    .slice(0, maxHashtags)
    .map((t) => `#${t}`)
    .join(" ");

  const header = `${script.hookLine}\n\nScripted and narrated with AI assistance, based on real sources:\n`;
  const footer = `\n\n${hashtags}`;

  const budget = MAX - header.length - footer.length;
  let sources = "";
  const seen = new Set<string>();
  for (const f of script.citedSources) {
    if (seen.has(f.sourceUrl)) continue;
    const line = `• ${f.sourceUrl}\n`;
    if (sources.length + line.length > budget) break;
    seen.add(f.sourceUrl);
    sources += line;
  }

  return `${header}${sources.trimEnd()}${footer}`.slice(0, MAX);
}
