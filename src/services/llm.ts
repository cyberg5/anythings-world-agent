import fetch from "node-fetch";
import { config } from "../config.js";

/**
 * Free-tier LLM access via OpenRouter.
 *
 * We tried two approaches that both broke within days:
 *   1. OpenRouter's "openrouter/free" auto-router — sometimes silently routed
 *      to a moderation-only model that returns "User Safety: safe" instead of
 *      a real completion.
 *   2. A hardcoded list of specific free model slugs — free-tier availability
 *      rotates constantly, and slugs that were free one day 404 as
 *      "unavailable for free" days later.
 *
 * The fix: fetch OpenRouter's live model catalog at the start of each run,
 * filter it ourselves for models that are ACTUALLY free (price is really 0,
 * not just this week) and that look like real text chat models (excluding
 * anything with "guard"/"moderation" in the name, which tend to be the
 * safety-classifier models that caused the "User Safety: safe" bug), then
 * pass a handful of them as OpenRouter's `models` fallback array. This is
 * self-healing — it can never go stale, because it never hardcodes a slug.
 */
let cachedFreeModels: string[] | null = null;

async function getFreeModels(): Promise<string[]> {
  if (cachedFreeModels) return cachedFreeModels;

  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) {
    throw new Error(`Failed to fetch OpenRouter model list: ${res.status}`);
  }
  const data = (await res.json()) as any;
  const models: any[] = data.data ?? [];

  const candidates = models
    .filter((m) => {
      const promptPrice = parseFloat(m?.pricing?.prompt ?? "1");
      const completionPrice = parseFloat(m?.pricing?.completion ?? "1");
      const isFree = promptPrice === 0 && completionPrice === 0;
      const outModalities: string[] = m?.architecture?.output_modalities ?? ["text"];
      const isText = outModalities.includes("text");
      const looksLikeModeration = /guard|moderation|safety/i.test(m.id ?? "");
      // Some providers (seen: Google AI Studio) reject response_format even
      // when OpenRouter lists the model as free — only trust models that
      // explicitly advertise support for it.
      const supportsJsonMode: string[] = m?.supported_parameters ?? [];
      const canDoJson =
        supportsJsonMode.includes("response_format") || supportsJsonMode.includes("structured_outputs");
      return isFree && isText && !looksLikeModeration && canDoJson;
    })
    // Prefer models with a larger context window — usually the more capable, better-maintained ones.
    // OpenRouter caps the fallback `models` array at 3 entries.
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
    .slice(0, 3)
    .map((m) => m.id as string);

  if (candidates.length === 0) {
    throw new Error(
      "No free text models currently support structured JSON output on OpenRouter. " +
        "Check https://openrouter.ai/models?max_price=0 for what's available."
    );
  }

  cachedFreeModels = candidates;
  return candidates;
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in output:\n${text}`);
  }
  return text.slice(start, end + 1);
}

export async function askForJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const models = await getFreeModels();

  // OpenRouter occasionally returns a transient "Gateway Timeout" under load —
  // that's infrastructure flakiness, not a real problem with the request, so
  // retry a couple of times before giving up (previously this burned a whole
  // orchestrator attempt — picking an entirely new topic — over a hiccup that
  // a 2-second wait would have resolved).
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callOpenRouter<T>(models, systemPrompt, userPrompt);
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

async function callOpenRouter<T>(models: string[], systemPrompt: string, userPrompt: string): Promise<T> {
  try {
    return await requestOpenRouter<T>(models, systemPrompt, userPrompt, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Our model-catalog filter (getFreeModels) checks `supported_parameters`
    // for response_format support, but that field is sometimes wrong for a
    // specific free-tier ROUTE (seen: a model listed as supporting it still
    // failed via the "Google AI Studio" backend specifically with "JSON mode
    // is not enabled for this model"). Rather than crash, retry the exact
    // same request without asking for response_format at all — the prompt
    // instruction + extractJsonObject() fallback below still get us valid
    // JSON most of the time, and this is far cheaper than burning a whole
    // orchestrator attempt (and a chunk of the 50-request/day free quota)
    // over a provider-side inconsistency we can't fix from our end.
    if (/JSON mode is not enabled/i.test(message)) {
      return await requestOpenRouter<T>(models, systemPrompt, userPrompt, false);
    }
    throw err;
  }
}

async function requestOpenRouter<T>(
  models: string[],
  systemPrompt: string,
  userPrompt: string,
  useResponseFormat: boolean
): Promise<T> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/",
      "X-Title": config.channelName.replace(/[^\x20-\x7E]/g, "").trim(),
    },
    body: JSON.stringify({
      models, // OpenRouter tries these in order on error/rate-limit/unavailability
      ...(useResponseFormat ? { response_format: { type: "json_object" } } : {}),
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
