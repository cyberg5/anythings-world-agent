import fetch from "node-fetch";
import { config } from "../config.js";

export interface SearchHit {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

/**
 * Real web search — this is the layer that makes facts verifiable instead of
 * the LLM inventing them. Never skip this step and never let the script
 * agent write a "fact" that didn't come through here with a URL attached.
 *
 * Primary provider is Tavily; Serper.dev is an AUTOMATIC fallback used only
 * when Tavily fails outright (bad/expired key, repeated 5xx, rate-limit) or
 * returns zero results. Both return the SAME SearchHit shape so every
 * downstream consumer (the anti-hallucination set-membership check in the
 * research agent) is provider-agnostic. If no fallback key is configured, a
 * Tavily failure propagates exactly as before.
 */
export async function searchWeb(query: string, maxResults = 6): Promise<SearchHit[]> {
  try {
    const hits = await searchTavily(query, maxResults);
    if (hits.length > 0) return hits;
    // Empty (not an error): try the fallback before giving up on this query.
    if (config.serperApiKey) {
      const fallback = await searchSerper(query, maxResults);
      if (fallback.length > 0) return fallback;
    }
    return hits; // both empty — let the caller decide (research agent handles 0 hits)
  } catch (tavilyErr) {
    if (!config.serperApiKey) throw tavilyErr;
    try {
      return await searchSerper(query, maxResults);
    } catch (serperErr) {
      // Surface both so the log makes it obvious BOTH providers are down,
      // not just one — loud failure beats a silent degrade (CLAUDE.md).
      const t = tavilyErr instanceof Error ? tavilyErr.message : String(tavilyErr);
      const s = serperErr instanceof Error ? serperErr.message : String(serperErr);
      throw new Error(`Both web-search providers failed. Tavily: ${t} | Serper: ${s}`);
    }
  }
}

/** Tavily — primary web-search provider. */
async function searchTavily(query: string, maxResults: number): Promise<SearchHit[]> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: config.tavilyApiKey,
          query,
          search_depth: "advanced",
          max_results: maxResults,
          include_answer: false,
        }),
      });
      if (!res.ok) {
        throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as any;
      return (data.results ?? []).map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        publishedDate: r.published_date,
      }));
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /Gateway Timeout|50[234]|ECONNRESET|ETIMEDOUT/i.test(message);
      if (!isTransient || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

/**
 * Serper.dev — automatic fallback. POSTs to the Google-search endpoint and
 * maps `organic[].{title,link,snippet,date}` into the same SearchHit shape
 * (link → url, snippet → content). Free tier, no card required.
 */
async function searchSerper(query: string, maxResults: number): Promise<SearchHit[]> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": config.serperApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: maxResults }),
      });
      if (!res.ok) {
        throw new Error(`Serper search failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as any;
      const organic: any[] = data.organic ?? [];
      return organic.slice(0, maxResults).map((r: any) => ({
        title: r.title,
        url: r.link,
        // Serper's `snippet` is shorter than Tavily's `content`, but it's a
        // real excerpt from a real URL — enough for the fact-tracing check.
        content: r.snippet ?? "",
        publishedDate: r.date,
      }));
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const isTransient = /Gateway Timeout|50[234]|ECONNRESET|ETIMEDOUT/i.test(message);
      if (!isTransient || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}
