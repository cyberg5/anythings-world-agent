import "dotenv/config";
import type { Platform } from "./types.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in — see README "One-time setup".`
    );
  }
  return v;
}

const PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram"];

// One pipeline run publishes to exactly ONE platform. Each platform has its
// own GitHub workflow that sets TARGET_PLATFORM, so a TikTok/Instagram
// failure can never turn the YouTube run red (and vice versa).
function targetPlatform(): Platform {
  const raw = (process.env.TARGET_PLATFORM?.trim() || "youtube").toLowerCase();
  if (!PLATFORMS.includes(raw as Platform)) {
    throw new Error(`TARGET_PLATFORM must be one of ${PLATFORMS.join(", ")} — got "${raw}".`);
  }
  return raw as Platform;
}

const platform = targetPlatform();

/** Required only when this run targets `p` — e.g. a TikTok run doesn't need YouTube keys. */
function requiredFor(p: Platform, name: string): string {
  return platform === p ? required(name) : process.env[name]?.trim() || "";
}

export const config = {
  platform,

  channelName: process.env.CHANNEL_NAME ?? "AnyThings World™",
  channelHandle: process.env.CHANNEL_HANDLE ?? "@Any-Future7",

  openRouterApiKey: required("OPENROUTER_API_KEY"),
  tavilyApiKey: required("TAVILY_API_KEY"),

  // Automatic fallback for web search when Tavily fails or returns nothing
  // (e.g. Tavily key dies / rate-limits mid-run). Optional on purpose — a
  // missing key just means "no fallback available", never a crash. Serper.dev
  // is free (no internationally-chargeable card required).
  serperApiKey: process.env.SERPER_API_KEY?.trim() || "",

  // Piper (local, offline, free TTS — no API key, no billing, no card).
  // TTS_VOICE must be a real Piper voice name. See VOICES.md linked in tts.ts.
  ttsVoice: process.env.TTS_VOICE?.trim() || "en_US-lessac-medium",

  pexelsApiKey: required("PEXELS_API_KEY"),

  // Automatic fallback for stock visuals when Pexels fails or has no genuinely
  // portrait clip/photo for a query. Optional — missing key = no fallback,
  // never a crash. Pixabay is free, no card, serves both video and images.
  pixabayApiKey: process.env.PIXABAY_API_KEY?.trim() || "",

  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  ytClientId: requiredFor("youtube", "YT_CLIENT_ID"),
  ytClientSecret: requiredFor("youtube", "YT_CLIENT_SECRET"),
  ytRefreshToken: requiredFor("youtube", "YT_REFRESH_TOKEN"),

  // TikTok Content Posting API (free; app registered at developers.tiktok.com).
  // TIKTOK_REFRESH_TOKEN is only the SEED from `npm run auth:tiktok` — TikTok
  // rotates the refresh token on every use, so the live one is kept in the
  // Supabase `platform_tokens` table (see services/tokenStore.ts).
  tiktokClientKey: requiredFor("tiktok", "TIKTOK_CLIENT_KEY"),
  tiktokClientSecret: requiredFor("tiktok", "TIKTOK_CLIENT_SECRET"),
  tiktokRefreshToken: requiredFor("tiktok", "TIKTOK_REFRESH_TOKEN"),
  // "inbox" = video lands in the TikTok app's inbox and you tap Post (works
  // before TikTok's app audit). "direct" = posts by itself (needs the
  // video.publish scope; unaudited apps can only post privately).
  tiktokPostMode: (process.env.TIKTOK_POST_MODE?.trim() || "inbox") as "inbox" | "direct",
  // Optional, only used to build a nicer video URL for the app/database.
  tiktokUsername: process.env.TIKTOK_USERNAME?.trim().replace(/^@/, "") || "",

  // Instagram API with Instagram Login (free; Meta developer app). Long-lived
  // token (60 days) from the app dashboard's "Generate token" — the pipeline
  // refreshes it automatically and keeps the live one in Supabase.
  instagramAccessToken: requiredFor("instagram", "INSTAGRAM_ACCESS_TOKEN"),
  instagramApiVersion: process.env.INSTAGRAM_API_VERSION?.trim() || "v25.0",

  videosPerRun: Number(process.env.VIDEOS_PER_RUN ?? "1"),

  // Every Nth video (by total published count ON THIS PLATFORM) is long-form
  // (>3 min, so YouTube classifies it as a regular video, not a Short) — the
  // rest are short-form. Default 4 for YouTube; 0 (= always short) for
  // TikTok/Instagram, where vertical short-form is the native format.
  longFormEveryN: Number(process.env.LONG_FORM_EVERY_N || (platform === "youtube" ? "4" : "0")),

  // Operator-chosen topics written by the CYE app — one file per platform.
  // YouTube keeps the original filename so nothing existing breaks.
  customTopicsFile:
    platform === "youtube" ? "data/custom_topics.json" : `data/custom_topics_${platform}.json`,
};
