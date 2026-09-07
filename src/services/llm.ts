import fetch from "node-fetch";
import { config } from "../config.js";

/**
 * Free-tier LLM access via OpenRouter (OpenAI-compatible API, no billing
 * required). We use OpenRouter's own "openrouter/free" router model, which
 * automatically picks from whichever free models are currently available —
 * this is the fix for free-model slugs rotating/disappearing over time
 * (which is exactly what broke this file's previous hardcoded model list).
 * See https://openrouter.ai/openrouter/free for details.
 *
 * Free tier limits (as of writing): ~20 req/min, 50 req/day per key
 * (rises to 1000/day after a one-time $10 credit top-up, which never
 * expires and is optional). One video costs ~4 LLM calls, so 50/day
 * comfortably covers VIDEOS_PER_RUN=1.
 */
const MODEL = "openrouter/free";

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
      model: MODEL,
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
