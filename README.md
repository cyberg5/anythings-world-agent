# AnyThings World™ — Autonomous Fact-Based Shorts Pipeline

A fully agentic pipeline for **@Any-Future7 / AnyThings World™**. Once deployed,
it runs on its own schedule with no daily involvement from you:

`Trend signal → Research (real, cited sources) → Script → Voice + visuals →
Branded render + watermark → Self-QA → Upload → Performance feedback`

It never copies another channel's content — it only borrows *topic signals*,
then independently researches real, documented facts via live web search and
writes an original script grounded only in what those sources actually say.

## Be straight with yourself about "zero involvement"

Everything below runs unattended forever, on a schedule, with no daily work
from you. But two things are one-time, and cannot be automated away —
not because this code is incomplete, but because of rules Google and the
API providers themselves enforce:

1. **Google requires the channel owner to personally approve upload access**
   (YouTube OAuth consent). This happens exactly once, in your browser
   (`npm run auth:youtube`). After that, the pipeline uploads forever
   without you touching anything.
2. **You need your own API accounts** for the LLM, search, voice, images,
   database, and YouTube — because these are billed/rate-limited per
   account, and no one can create *your* accounts for you. All are cheap
   or have free tiers; total setup is ~15 minutes.

After those two things, the system truly runs itself — a GitHub Actions
schedule (included) triggers it daily with no server for you to babysit.

## What's in this project

```
src/
  agents/         trendAgent, researchAgent, scriptAgent, productionAgent, qaAgent, uploadAgent
  services/       llm.ts, webSearch.ts, tts.ts, visuals.ts, youtube.ts, supabase.ts
  branding/       template.ts — your intro card + captions + watermark, built with ffmpeg
  orchestrator.ts the full pipeline, one run = one attempted video
assets/           your extracted, transparent AnyThings World™ watermark (already made from your logo)
supabase/schema.sql   run once in your Supabase project
.github/workflows/    daily video run + weekly performance snapshot (the actual "automation")
```

## One-time setup (~15 minutes)

1. **OpenRouter** (script writing, free) — openrouter.ai/keys → sign up (no card needed) → API key → `OPENROUTER_API_KEY`
2. **Tavily** (real web search — this is what makes facts verifiable instead
   of invented) — tavily.com → free tier → `TAVILY_API_KEY`
3. **Narrator voice** — Piper (local, offline, free forever, no API key,
   no account, no card). The GitHub Actions workflow installs it automatically
   (`pip install piper-tts`) and downloads the voice model on first run —
   nothing for you to sign up for.
   - Optionally set `TTS_VOICE` in `.env` (default: `en_US-lessac-medium`). Run
     `npx tsx src/scripts/listVoices.ts` to see other options.
4. **Pexels** (real licensed stock photos matched to each cited fact, free) — pexels.com/api → `PEXELS_API_KEY`
5. **Supabase** — create a project → SQL editor → paste `supabase/schema.sql` and run it →
   Project Settings → API → copy `SUPABASE_URL` and the `service_role` key
6. **Google Cloud / YouTube Data API v3**:
   - console.cloud.google.com → new project → enable "YouTube Data API v3"
   - OAuth consent screen → external → add yourself as a test user
   - Credentials → OAuth client ID → type "Desktop app" → copy `YT_CLIENT_ID` / `YT_CLIENT_SECRET`
   - Run `npm run auth:youtube`, open the printed link, approve as the channel owner,
     paste the printed `YT_REFRESH_TOKEN` into `.env`

Copy `.env.example` to `.env` and fill in everything above to test locally
(also run `pip install piper-tts` once on your machine, same as the workflow does):

```bash
npm install
npm run build
npm run auth:youtube      # one-time browser approval
npm run run:once          # produces + uploads one real video end-to-end
```

## Turning on full automation (no server needed)

1. Push this repo to GitHub (private repo is fine).
2. Repo → Settings → Secrets and variables → Actions → add every value from
   your `.env` as a matching secret (same names).
3. Done. `.github/workflows/daily-run.yml` uploads one new video every day;
   `weekly-performance.yml` records stats weekly so the trend agent learns
   which topics actually work. Change the cron schedule in either file to
   adjust frequency.

## Design choices worth knowing about

- **Free LLM**: script writing runs on OpenRouter's `:free` models (no
  billing). Which models are free rotates over time — `src/services/llm.ts`
  lists several candidates in priority order and OpenRouter automatically
  falls through if one is down or rate-limited. If everything starts
  failing at once, check https://openrouter.ai/models?max_price=0 for the
  current free list and update that array.
- **Narration**: voice is synthesized via Piper, a local/offline neural TTS
  engine — no API key, no billing, no card, ever. Two earlier attempts were
  tried and abandoned: an unofficial free trick (msedge-tts) that occasionally
  returned corrupt/silent audio with no error — producing videos with
  captions but no narration for stretches — and Google Cloud TTS, which is
  reliable but requires a billing account with an internationally-chargeable
  card, unavailable to everyone. Piper avoids both problems by never calling
  an external API at synthesis time at all. Worth remembering if you ever
  swap providers again: always validate TTS output (duration, non-silence)
  before trusting it in an unattended pipeline — `tts.ts` does this.
- **Anti-hallucination gate**: `researchAgent.ts` only accepts facts whose
  source URL is copied verbatim from a real Tavily search result. Anything
  the LLM can't attribute to an actual source gets thrown out before it ever
  reaches the script.
- **Self-QA instead of human review**: since you don't want to be in the
  loop, `qaAgent.ts` is deliberately strict — it rejects and retries rather
  than publishing anything it's unsure about. Tune its thresholds in that
  file as you see real output.
- **AI disclosure**: every description states the video is AI-assisted and
  lists sources — required under YouTube's current synthetic-content policy
  and also your best protection against "low-value AI content" review flags.
- **Branding**: `src/branding/template.ts` renders a 2-second intro card
  (your logo + title + channel name) and keeps a small semi-transparent
  watermark of your logo in the bottom-right corner for the whole video.
  Colors/fonts are constants at the top of that file — easy to restyle later.
- **The watermark asset** (`assets/logo_watermark_*.png`) was extracted from
  the logo you sent by keying out the black background, so it overlays
  cleanly on any footage.

## Realistic first-week expectations

YouTube Shorts monetization requires 1,000 subscribers and 10M valid Shorts
views in 90 days (or 4,000 watch-hours/1,000 subs for long-form) — this
pipeline gets you consistent, compliant output, not a guaranteed timeline.
Watch the first 5-10 uploads closely (via YouTube Studio, not by touching
the pipeline) before trusting it to run for months unattended.
