import fetch from "node-fetch";
import { config } from "../config.js";

/**
 * Free-tier LLM access via OpenRouter. Earlier this used the "openrouter/free"
 * auto-router, but that occasionally routed to a moderation/safety-only model
 * that returns a bare "User Safety: safe" instead of a real completion — not
 * a real chat model at all. Pinning to specific, long-standing free instruct
 * models avoids that. The `models` array is OpenRouter's built-in fallback:
 * it tries each in order if one errors or is rate-limited.
 *
 * If all of these ever stop working, check https://openrouter.ai/models?max_price=0
 * for current free models and swap the list below.
 */
const FREE_MODELS = [
  "mistralai/mistral-7b-instruct:free",
  "meta-llama/llama-3.3-8b-instruct:free",
  "meta-llama/llama-3.2-3b-instruct:free",
];

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in output:\n${text}`);
  }
  return text.slice(start, end + 1);
}

export async function askForJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/",
      "X-Title": config.channelName.replace(/[^\x20-\x7E]/g, "").trim(),
    },
    body: JSON.stringify({
      models: FREE_MODELS, // OpenRouter tries these in order on error/rate-limit
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            systemPrompt +
            `\n\nRespond with ONLY raw JSON, no markdown fences, no commentary, no reasoning ` +
            `shown before or after. Wrap the whole answer in a single top-level JSON object ` +
            `with one key "result" — e.g. {"result": <your answer here>}.`,
        },
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

  let parsed: any;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    try {
      parsed = JSON.parse(extractJsonObject(text));
    } catch {
      throw new Error(`LLM did not return valid JSON. Raw output:\n${text}`);
    }
  }

  if (!("result" in parsed)) {
    throw new Error(`LLM response missing "result" key. Raw output:\n${text}`);
  }
  return parsed.result as T;
}
