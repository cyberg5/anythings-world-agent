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

    // Google Cloud Text-to-Speech (official API, generous free tier).
  // TTS_VOICE must be a real Google voice name — default is a natural-sounding
  // Neural2 voice. See https://cloud.google.com/text-to-speech/docs/voices
  googleTtsApiKey: required("GOOGLE_TTS_API_KEY"),
  ttsVoice: process.env.TTS_VOICE?.trim() || "en-US-Neural2-D",

  pexelsApiKey: required("PEXELS_API_KEY"),

  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  ytClientId: required("YT_CLIENT_ID"),
  ytClientSecret: required("YT_CLIENT_SECRET"),
  ytRefreshToken: required("YT_REFRESH_TOKEN"),

  videosPerRun: Number(process.env.VIDEOS_PER_RUN ?? "1"),
};
