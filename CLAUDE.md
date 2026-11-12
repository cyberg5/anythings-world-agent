# AnyThings World™ — Autonomous YouTube Agent

## What this is
A fully autonomous pipeline that runs on GitHub Actions (cron + manual dispatch),
picks a topic, researches it with real cited sources, writes a script, produces a
branded vertical video (real b-roll + narration + captions + watermark), runs it
through automated QA, and uploads it to YouTube (@Any-Future7 / channel name
"AnyThings World™"). No human touches any individual video. Zero paid services —
every external dependency was deliberately chosen or replaced to avoid requiring
a credit card (the operator has no internationally-chargeable card).

Repo: github.com/cyberg5/anythings-world-agent (this IS the source of truth —
the human has been editing files directly on GitHub's web UI across many
sessions, so always `git pull` / re-read files before assuming local state
matches what's deployed).

## Pipeline (src/orchestrator.ts runs this every invocation)
`pickNextTopic → buildResearchDossier → writeScript → produceVideo → runQA → publish`

Each stage is its own module under `src/agents/` and `src/services/`. If QA
rejects, the orchestrator retries with a **brand new topic/script**, not the
same one — several of the bugs below only got fixed once we stopped retrying
identical inputs into a deterministic engine (see Piper note).

## Format split (short vs. long)
Every Nth published video (`LONG_FORM_EVERY_N`, default 4, tracked via a
Supabase count query in `getPublishedVideoCount()`) is long-form; the rest are
Shorts. This is decided ONCE per orchestrator run in `main()` and threaded
through `TrendCandidate.format` → `VideoScript.format` everywhere.

- YouTube Shorts classification is **automatic**: vertical aspect ratio +
  duration ≤ 3 minutes (180s). The `#Shorts` tag does NOT affect
  classification — don't rely on it.
- Short target: ~60-90s narration, QA hard bounds 40-170s (actual rendered
  file, via ffprobe — NOT the script's estimated duration, see below).
- Long target: ~4-5 min narration, QA hard bounds 190-400s, deliberately
  well clear of 180s so it's unambiguously a regular video.

## Free-tier service choices (and why, in order of what we tried and abandoned)
- **LLM**: OpenRouter, `src/services/llm.ts`. Do NOT hardcode a model slug —
  free-model availability rotates constantly and slugs 404 within days. The
  auto-router `openrouter/free` was also tried and rejected: it sometimes
  silently routes to a moderation-only model that returns `"User Safety:
  safe"` instead of a real completion. Current approach: fetch OpenRouter's
  live `/models` catalog every run, filter for `pricing == 0` AND
  `supported_parameters` includes `response_format`/`structured_outputs`
  (some free models — seen: Google AI Studio route — reject `response_format`
  even though OpenRouter lists them as free), exclude anything with
  guard/moderation/safety in the id, sort by context length, take top 3 (API
  hard-caps the fallback `models` array at 3). Every response must be wrapped
  in `{"result": ...}` because `response_format: json_object` requires a
  top-level object, not an array — `askForJson<T>` unwraps `.result`.
  Transient `Gateway Timeout` / 5xx errors are retried a few times before
  giving up (they used to burn a whole orchestrator attempt over nothing).
- **Web search**: Tavily (`src/services/webSearch.ts`) — this is the
  anti-hallucination layer. The research agent NEVER lets the LLM assert a
  fact from memory; every claim must trace to a URL that was actually in the
  Tavily results (verified by set-membership check, catching LLM drift).
- **TTS**: Piper (`src/services/tts.ts`), fully local/offline, installed via
  `pip install piper-tts` in the workflow. No API key/billing/card, ever.
  Two earlier providers were tried and abandoned: msedge-tts (unofficial,
  occasionally returned corrupt/silent audio) and Google Cloud TTS (official
  and reliable, but requires a billing account with an internationally
  chargeable card — not available to this operator).
  - **Newer piper-tts no longer auto-downloads voices.** The workflow has an
    explicit "Download Piper voice model" step
    (`python3 -m piper.download_voices en_US-lessac-medium --download-dir
    "$HOME/.local/share/piper-voices"`) that MUST match both `TTS_VOICE` and
    the `PIPER_DATA_DIR` constant in `tts.ts`, or synthesis fails with
    "Unable to find voice".
  - **Piper is deterministic.** Retrying identical text after a bad result is
    close to useless — it fails the same way every time. `synthesizeSpeech`
    throws immediately on a bad result instead of retrying, so the whole
    video attempt fails and the orchestrator picks a fresh script (different
    text) next attempt — that's what actually breaks a failure loop.
  - **Validate duration in BOTH directions.** A real production incident:
    Piper produced ~3500 seconds of audio for a short line of text, which
    then made the video segment (via `-stream_loop -1 ... -shortest` in
    template.ts) balloon to match it. `assertValidAudio` checks a minimum
    (silence/too-short) AND a maximum (`wordCount / 1.5` seconds, floor 15s)
    — only checking "too short" was the original design and it missed this
    class of bug for a long time. `productionAgent.ts` also independently
    re-checks each rendered SEGMENT's actual duration against
    `seg.approxSeconds * 3` as defense in depth, since the runaway could in
    principle originate in the ffmpeg step rather than Piper itself.
  - **Silence detection must use `silencedetect`, not average volume.** An
    average-volume/mean_volume check misses a long silent patch inside an
    otherwise-normal clip if the rest is loud enough to pull the mean up.
    Current threshold: `noise=-40dB:d=1.0`, reject if any single silence
    block exceeds 1.5s. This threshold MUST match between `tts.ts` (per
    segment, catches bad audio immediately) and `qaAgent.ts` (whole final
    file, catches anything that slipped through, e.g. bad concatenation).
    They drifted once (-35dB vs -40dB) and it wasted whole attempts.
- **Visuals**: Pexels, `src/services/visuals.ts`. Prefers real VIDEO b-roll
  (`fetchStockVideo`) over static photos — this is what makes it look like
  documentary footage instead of a slideshow. Falls back to a still image
  with Ken Burns zoom (`fetchStockImage`) ONLY when no genuinely
  portrait-oriented video exists for the query.
  - **Never force-crop landscape video into the vertical frame.** An earlier
    version fell back to any available file including landscape ones and
    cover-cropped them — for a wide source that crop has to blow the image up
    until height fills 1920px, crushing the frame into an extremely
    zoomed-in sliver of the original scene. `fetchStockVideo` now checks the
    TOP-LEVEL video's own width/height (its real source orientation, not
    just per-quality file variants) and returns `null` (triggering the image
    fallback) if it isn't genuinely portrait.
- **Database**: Supabase (`videos`, `performance_snapshots` tables — schema
  in `supabase/schema.sql`). Used for dedup (don't repeat a topic), the
  feedback loop (bias future topics toward what performed well), and the
  short/long format counter.
- **Upload**: YouTube Data API v3 (`src/services/youtube.ts`), OAuth2 with a
  refresh token obtained once via `npm run auth:youtube`
  (`src/services/youtubeAuthSetup.ts`).
  - **Refresh tokens expire in 7 days** while the Google Cloud OAuth consent
    screen is in "Testing" publishing status (external user type). This is a
    hard Google platform rule, not a bug — re-run `auth:youtube` and update
    the `YT_REFRESH_TOKEN` secret when it happens. Moving the app to
    "In production" would fix this permanently but requires Google's
    verification/audit process for the YouTube upload scope.
  - Must sign in as the Google account that actually owns/manages the
    target channel, AND that account must be added under "Test users" on the
    OAuth consent screen, or auth fails with `Error 403: access_denied`.
  - `titleSuffix` (`" #Shorts"`) and the output URL shape
    (`/shorts/<id>` vs `/watch?v=<id>`) both depend on `script.format`.

## ffmpeg / rendering gotchas (src/branding/template.ts) — all empirically
verified against the actual ffmpeg build in the GitHub Actions Ubuntu runner;
some contradict the general ffmpeg documentation
- `%` breaks drawtext's text-expansion parser no matter how you try to escape
  it (`\%`, `%%`, `expansion=none` — none work in this build). Fix: spell it
  out as the word "percent" before rendering (also matches how TTS reads it).
- `:` DOES need a backslash escape even inside single-quoted inline
  `text='...'` values, or it's read as a drawtext option separator and
  truncates everything after it. BUT for text passed via `textfile=` (the
  intro title), do NOT backslash-escape colons — that context takes the
  file's raw bytes literally and a backslash shows up as a literal
  backslash on screen.
- `'` (apostrophe) cannot be reliably embedded at all in this build — every
  documented escape trick (`\'`, and the close-quote/escaped-quote/reopen-
  quote `'\''` sequence) caused the rest of the filter string to be
  swallowed as literal text. Current fix: strip apostrophes entirely
  ("Webb's" → "Webbs"). Cosmetically imperfect, reliably correct.
- Whitespace-collapsing regexes used for the above (`.replace(/[ \t]+/g,
  " ")`) must NOT touch newlines — an earlier version used `\s+` and
  silently un-wrapped multi-line captions/titles back into one overflowing
  line, which is also why...
- **Captions and the intro title both need manual wrapping**
  (`wrapForDrawtext`, char-based line breaking) — ffmpeg's drawtext does not
  auto-wrap. An inline `text='line1\nline2'` value DOES render as multiple
  lines correctly in this build (verified), same as `textfile=`.
- **Audio sample rate/channels must be forced identical everywhere**
  (`-ar 44100 -ac 2` on every audio-encoding ffmpeg call: both branches of
  `buildSegmentClip`, and the intro's `anullsrc`). Segments built from
  Piper's native WAV rate (often 22050Hz mono) concatenated via `-c copy`
  next to the intro's 44100Hz stereo silence produced choppy, glitchy audio
  from the very start of playback — a classic sample-rate-mismatch symptom,
  not a synthesis problem.
- **The intro card's first ~2 seconds are deliberately silent** (branded
  title card, no narration yet). `qaAgent.ts`'s whole-file silence check
  must skip this with `-ss 2.3` before running `silencedetect`, or it
  rejects literally every single video for "silence" that's just the intro
  doing its job — this was a real incident that blocked all uploads for a
  while and looked like a content bug but wasn't.
- Real b-roll video segments: `-stream_loop -1` on the video input + `-shortest`
  is what makes a short stock clip loop to cover however long the real
  (post-TTS) narration turns out to be, rather than trusting the script's
  `approxSeconds` estimate — the estimate is frequently wrong and trusting it
  is what caused several duration-related incidents above.

## Companion mobile app (CYE) + operator-chosen topics
A Flutter management app lives in `atw_manager/` (package name "CYE — Cyber
Youtube Earn"). It reads videos from Supabase (anon key, read-only RLS — see
`supabase/app_read_policies.sql`), reads live YouTube stats via the same OAuth
refresh token, and reads/triggers GitHub Actions via a Personal Access Token.
All secrets live in the phone's secure storage, never hardcoded.

- **Operator-chosen topics** flow from the app into the pipeline via a repo
  file: the app writes `data/custom_topics.json` (a JSON array of strings) using
  the GitHub Contents API, and `trendAgent.pickNextTopic()` reads it FIRST —
  the first not-yet-used custom topic wins, and the LLM only crafts an angle for
  that exact topic (never changes the topic). Empty/missing file → normal
  auto-generation. The app's GitHub PAT therefore needs `repo` + `workflow`
  scopes.
- **Multi-platform (YouTube / TikTok / Instagram).** `TARGET_PLATFORM` picks
  the platform per run (one workflow per platform, all calling
  `produce-video.yml`). Each platform has its own topics file
  (`data/custom_topics.json`, `_tiktok.json`, `_instagram.json`) and its own
  profile file `data/profile_<platform>.json` = `{channelName, niche}`, both
  written by the app. `config.ts` reads the profile: `channelName` overrides
  the `CHANNEL_NAME` env (watermark, captions, hashtags); `niche` replaces the
  default mysteries/science guidance in `trendAgent` so auto-picked topics stay
  in that platform's subject. Empty/missing = old defaults. Channel names
  must be Latin letters (drawn by drawtext; no Persian-glyph font).

## Content/engagement design (src/agents/scriptAgent.ts, trendAgent.ts)
Optimized for retention and channel growth, not just factual accuracy:
- Topic selection defaults toward unsolved mysteries, myth-vs-truth reveals,
  and mind-blowing science — research (both web search and this channel's own
  Supabase performance history) points to these outperforming dry
  encyclopedic topics for this format.
- Script structure: hook in the first ~3s (curiosity gap or bold claim, never
  a bland topic announcement) → escalating segments with a mid-video re-hook
  line → a final segment that's a direct, story-specific call-to-action
  (comment/follow), not generic. Every claim still traces only to
  `ResearchDossier.facts` — engagement framing changes HOW it's told, never
  what's claimed.

## Environment / secrets (GitHub Actions repo secrets)
`OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `PEXELS_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `YT_CLIENT_ID`, `YT_CLIENT_SECRET`,
`YT_REFRESH_TOKEN`. Optional: `TTS_VOICE` (default `en_US-lessac-medium`),
`LONG_FORM_EVERY_N` (default 4), `VIDEOS_PER_RUN` (default 1). No secret is
needed for Piper (fully local) or Pexels video vs. photo (same key).

## Known platform quirk to watch for
GitHub's own scheduled (`cron`) trigger is officially documented as
best-effort — it can be delayed or occasionally silently skipped during high
load on GitHub's infrastructure. If a scheduled run doesn't appear in the
Actions tab at all (not even a failed one), that's GitHub's scheduler, not
this codebase — the practical fix is just to trigger `workflow_dispatch`
manually and keep an eye on whether it becomes a pattern.

## Debugging workflow that worked well across many sessions
1. Get the actual failing GitHub Actions log (or the actual output video
   file) — guessing at ffmpeg/audio/timing bugs from description alone
   wasted much more time than just inspecting the real artifact.
2. For anything audio/video, actually run ffprobe/ffmpeg locally against the
   real (or a synthetic reproduction of the) file before proposing a fix —
   several "obvious per the docs" escaping/threshold assumptions turned out
   to be wrong in this specific ffmpeg build, and were only caught by
   testing, not by reasoning from documentation.
3. Prefer fixes that make failure LOUD (throw, fail the attempt, retry with
   fresh input) over ones that silently degrade — nearly every multi-day bug
   in this project's history was originally invisible because something
   validated too leniently and let a broken video reach upload.
