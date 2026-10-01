import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in — see README "One-time setup".`
    );
  }
  return v;
}

export const config = {
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

  ytClientId: required("YT_CLIENT_ID"),
  ytClientSecret: required("YT_CLIENT_SECRET"),
  ytRefreshToken: required("YT_REFRESH_TOKEN"),

  videosPerRun: Number(process.env.VIDEOS_PER_RUN ?? "1"),

  // Every Nth video (by total published count) is long-form (>3 min, so it's
  // automatically classified as a regular video, not a Short) — the rest are
  // short-form. Default 4 = roughly 1 long-form video for every 3 Shorts.
  longFormEveryN: Number(process.env.LONG_FORM_EVERY_N ?? "4"),
};
