import { open, stat } from "fs/promises";
import { config } from "../config.js";
import { loadToken, saveToken } from "./tokenStore.js";
import { buildSocialCaption } from "./socialCaption.js";
import type { ProducedVideo, UploadResult } from "../types.js";

// TikTok Content Posting API v2 — https://developers.tiktok.com/doc/content-posting-api-get-started
const API = "https://open.tiktokapis.com/v2";
const TOKEN_KEY = "tiktok_refresh_token";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exchanges the refresh token for a 2-hour access token. TikTok rotates the
 * refresh token on EVERY call and invalidates the old one immediately, so the
 * new one is saved before anything else happens — losing it would mean the
 * operator has to run `npm run auth:tiktok` again.
 */
async function getAccessToken(): Promise<string> {
  const seed = config.tiktokRefreshToken;
  const stored = await loadToken(TOKEN_KEY, seed);
  const refreshToken = stored?.value ?? seed;

  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: config.tiktokClientKey,
      client_secret: config.tiktokClientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(
      `TikTok token refresh failed (HTTP ${res.status}: ${json.error ?? ""} ${json.error_description ?? ""}). ` +
        `If the refresh token expired (180 days) or was revoked, run "npm run auth:tiktok" and update the TIKTOK_REFRESH_TOKEN secret.`
    );
  }
  if (json.refresh_token && json.refresh_token !== refreshToken) {
    await saveToken(TOKEN_KEY, seed, json.refresh_token);
  }
  return json.access_token as string;
}

async function tiktokPost(token: string, path: string, body: unknown): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body ?? {}),
    });
    const json: any = await res.json().catch(() => ({}));
    const code = json?.error?.code;
    if (res.ok && (!code || code === "ok")) return json.data ?? {};
    if (res.status >= 500 && attempt < 3) {
      await sleep(3000 * attempt);
      continue;
    }
    throw new Error(`TikTok ${path} failed (HTTP ${res.status}): ${code ?? ""} ${json?.error?.message ?? ""}`.trim());
  }
}

/**
 * Chunk plan per TikTok's media transfer guide: chunks 5–64 MB, count =
 * floor(size / chunk), the remainder rides on the last chunk (≤128 MB);
 * files under the 5 MB minimum (or under one chunk) go up in a single piece.
 */
function chunkPlan(size: number): { chunkSize: number; count: number } {
  const CHUNK = 10 * 1024 * 1024;
  if (size < CHUNK) return { chunkSize: size, count: 1 };
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

async function uploadFile(uploadUrl: string, filePath: string, size: number, chunkSize: number, count: number) {
  const fh = await open(filePath, "r");
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
      const buf = Buffer.alloc(end - start + 1);
      await fh.read(buf, 0, buf.length, start);

      for (let attempt = 1; ; attempt++) {
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            // Content-Length is set by fetch from the Buffer itself.
            "Content-Range": `bytes ${start}-${end}/${size}`,
          },
          body: buf,
        });
        const isLast = i === count - 1;
        if ((isLast && (res.status === 201 || res.status === 200)) || (!isLast && res.status === 206)) break;
        if (res.status >= 500 && attempt < 3) {
          await sleep(3000 * attempt);
          continue;
        }
        throw new Error(`TikTok chunk ${i + 1}/${count} upload failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
      }
    }
  } finally {
    await fh.close();
  }
}

/** Polls until TikTok accepts the post. Throws on FAILED so the attempt is loud, not silent. */
async function waitForTikTok(token: string, publishId: string): Promise<string | null> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const data = await tiktokPost(token, "/post/publish/status/fetch/", { publish_id: publishId });
    const status = data.status as string;
    if (status === "FAILED") throw new Error(`TikTok rejected the video: ${data.fail_reason ?? "unknown reason"}`);
    if (status === "SEND_TO_USER_INBOX") return null;
    if (status === "PUBLISH_COMPLETE") {
      const ids = data.publicaly_available_post_id; // (sic) — TikTok's own spelling
      return Array.isArray(ids) && ids.length ? String(ids[0]) : null;
    }
    await sleep(10_000);
  }
  // The file is fully uploaded (final chunk returned 201) — retrying would
  // risk a duplicate post, so record it and let the operator check TikTok.
  console.warn(`TikTok still processing ${publishId} after 10 min — recording it as published.`);
  return null;
}

export async function uploadToTikTok(video: ProducedVideo): Promise<UploadResult> {
  const token = await getAccessToken();
  const { size } = await stat(video.filePath);
  const { chunkSize, count } = chunkPlan(size);
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: count };

  const caption = buildSocialCaption(video.script, 8);
  let username = config.tiktokUsername;
  let init: any;
  if (config.tiktokPostMode === "direct") {
    const creator = await tiktokPost(token, "/post/publish/creator_info/query/", {});
    username = username || creator.creator_username || "";
    const maxSec = Number(creator.max_video_post_duration_sec ?? 0);
    if (maxSec && video.durationSeconds > maxSec) {
      throw new Error(`Video is ${video.durationSeconds}s but this TikTok account allows at most ${maxSec}s.`);
    }
    const options: string[] = creator.privacy_level_options ?? [];
    const wanted = process.env.TIKTOK_PRIVACY?.trim();
    const privacy =
      (wanted && options.includes(wanted) && wanted) ||
      (options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[options.length - 1] ?? "SELF_ONLY");

    init = await tiktokPost(token, "/post/publish/video/init/", {
      post_info: {
        title: caption,
        privacy_level: privacy,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        is_aigc: true, // TikTok's own "AI-generated" label — required disclosure for this channel
      },
      source_info,
    });
  } else {
    // Inbox mode: TikTok doesn't accept a caption here — the operator taps
    // the inbox notification in the TikTok app, pastes/edits, and posts.
    // NOTE: TikTok allows at most 5 pending inbox drafts per 24h.
    init = await tiktokPost(token, "/post/publish/inbox/video/init/", { source_info });
  }

  await uploadFile(init.upload_url, video.filePath, size, chunkSize, count);
  const postId = await waitForTikTok(token, init.publish_id);

  const profile = username ? `https://www.tiktok.com/@${username}` : "https://www.tiktok.com/";
  return {
    platform: "tiktok",
    videoId: postId ?? init.publish_id,
    url: postId && username ? `${profile}/video/${postId}` : profile,
    caption, // shown/copyable in the CYE app — needed in inbox mode, where you paste it yourself
  };
}
