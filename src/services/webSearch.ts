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
 */
export async function searchWeb(query: string, maxResults = 6): Promise<SearchHit[]> {
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
      const isTransient = /Gateway Timeout|50[234]|ECONNRESET|ETIMEDOUT|Premature close|ERR_STREAM_PREMATURE_CLOSE/i.test(
        message
      );
      if (!isTransient || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}
