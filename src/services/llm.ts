import fetch from "node-fetch";
import { config } from "../config.js";

/**
 * Free-tier LLM access via OpenRouter (OpenAI-compatible API, no billing
 * required for ":free" models). We pass SEVERAL candidate free models in
 * priority order — OpenRouter automatically falls through to the next one
 * if the first is rate-limited or temporarily down. This matters because
 * free-model availability rotates; hardcoding just one is fragile.
 *
 * Free tier limits (as of writing): ~20 req/min, 50 req/day per key
 * (rises to 1000/day after a one-time $10 credit top-up, which never
 * expires and is optional). One video costs ~4 LLM calls, so 50/day
 * comfortably covers VIDEOS_PER_RUN=1.
 *
 * If a request fails, check https://openrouter.ai/models?order=top-weekly&max_price=0
 * for the current list of free models and update FREE_MODEL_CANDIDATES below.
 */
const FREE_MODEL_CANDIDATES = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-4-maverick:free",
  "google/gemini-2.0-flash-exp:free",
];

export async function askForJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/", // OpenRouter requires *a* referer; any value works
      // Header values can only contain plain ASCII — strip symbols like ™ from
      // the channel name here (this bit Node's http client with ERR_INVALID_CHAR).
      "X-Title": config.channelName.replace(/[^\x20-\x7E]/g, "").trim(),
    },
    body: JSON.stringify({
      models: FREE_MODEL_CANDIDATES, // OpenRouter tries these in order
      messages: [
        { role: "system", content: systemPrompt + "\nRespond with ONLY raw JSON. No markdown fences, no prose." },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const text: string = data.choices?.[0]?.message?.content ?? "";
  const cleaned = text.replace(/^```json\s*|```$/g, "").trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    throw new Error(`LLM did not return valid JSON. Raw output:\n${text}`);
  }
}
