import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { config } from "../config.js";
import { loadToken, saveToken } from "./tokenStore.js";
import { buildSocialCaption } from "./socialCaption.js";
import type { ProducedVideo, UploadResult } from "../types.js";

// Instagram API with Instagram Login — Reels via resumable upload, so the MP4
// goes straight from the Actions runner to Meta (no public hosting needed).
// https://developers.facebook.com/docs/instagram-platform/content-publishing
const run = promisify(execFile);
const TOKEN_KEY = "instagram_access_token";
const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const graph = (path: string) => `https://graph.instagram.com/${config.instagramApiVersion}${path}`;

async function igFetch(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, init);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new Error(`Instagram API ${res.status}: ${e.message ?? JSON.stringify(json)} (code ${e.code ?? "?"})`);
  }
  return json;
}

/**
 * Long-lived tokens expire after 60 days unless refreshed (and a token must
 * be ≥24h old to refresh). We refresh at most once a week and keep the live
 * token in Supabase. A failed refresh is NOT fatal — the current token still
 * works until it expires — but it's logged loudly.
 */
async function getAccessToken(): Promise<string> {
  const seed = config.instagramAccessToken;
  const stored = await loadToken(TOKEN_KEY, seed);
  const token = stored?.value ?? seed;

  if (stored && Date.now() - stored.updatedAt.getTime() < REFRESH_EVERY_MS) return token;

  try {
    const json = await igFetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
    );
    await saveToken(TOKEN_KEY, seed, json.access_token);
    console.log(`Instagram token refreshed (valid ~${Math.round(json.expires_in / 86400)} more days).`);
    return json.access_token;
  } catch (err) {
    console.warn("WARNING: Instagram token refresh failed — using the current token.", err);
    if (!stored) await saveToken(TOKEN_KEY, seed, token); // start the 7-day clock so we don't retry every run
    return token;
  }
}

/** Meta requires the moov atom at the front of the file; our render doesn't guarantee that. */
async function faststartCopy(filePath: string): Promise<string> {
  const out = filePath.replace(/\.mp4$/i, "") + ".ig.mp4";
  await run("ffmpeg", ["-y", "-i", filePath, "-c", "copy", "-movflags", "+faststart", out]);
  return out;
}

export async function uploadToInstagram(video: ProducedVideo): Promise<UploadResult> {
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };

  const me = await igFetch(graph(`/me?fields=user_id,username`), { headers: auth });
  const igId = me.user_id ?? me.id;

  const caption = buildSocialCaption(video.script, 15); // IG hard limit is 30 hashtags
  const container = await igFetch(graph(`/${igId}/media`), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", upload_type: "resumable", caption, share_to_feed: true }),
  });

  const file = await readFile(await faststartCopy(video.filePath));
  const upload = await fetch(container.uri ?? `https://rupload.facebook.com/ig-api-upload/${config.instagramApiVersion}/${container.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(file.length) },
    body: file,
  });
  const upJson: any = await upload.json().catch(() => ({}));
  if (!upload.ok || upJson.success === false) {
    throw new Error(`Instagram video upload failed (HTTP ${upload.status}): ${JSON.stringify(upJson.debug_info ?? upJson)}`);
  }

  // Processing is asynchronous — wait for FINISHED before publishing.
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    const s = await igFetch(graph(`/${container.id}?fields=status_code,status`), { headers: auth });
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new Error(`Instagram could not process the Reel: ${s.status_code} ${s.status ?? ""}`);
    }
    if (Date.now() > deadline) throw new Error("Instagram Reel still processing after 10 minutes — not published.");
    await sleep(20_000);
  }

  const published = await igFetch(graph(`/${igId}/media_publish`), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id }),
  });

  let url = me.username ? `https://www.instagram.com/${me.username}/` : "https://www.instagram.com/";
  try {
    const m = await igFetch(graph(`/${published.id}?fields=permalink`), { headers: auth });
    if (m.permalink) url = m.permalink;
  } catch {
    // permalink is cosmetic; the Reel is already live
  }

  return { platform: "instagram", videoId: String(published.id), url, caption };
}
