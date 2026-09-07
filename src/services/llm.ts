import fetch from "node-fetch";
import { config } from "../config.js";

/**
 * Free-tier LLM access via OpenRouter. We use OpenRouter's own
 * "openrouter/free" router model, which picks from whichever free models
 * are currently available. Combined with `response_format: json_object`,
 * the router specifically filters for free models that support structured
 * JSON output — without this, it sometimes picks a reasoning/safety-classifier
 * model that ignores "respond with only JSON" and returns chain-of-thought
 * text or garbled tokens instead.
 *
 * Because json_object mode requires a top-level JSON *object* (not an array),
 * every response is asked to wrap its real answer in {"result": ...} — this
 * works whether the caller's T is an array or an object, since we just
 * unwrap .result before returning.
 */
const MODEL = "openrouter/free";

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
      model: MODEL,
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
