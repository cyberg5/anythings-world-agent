import { google } from "googleapis";
import { createReadStream } from "fs";
import { config } from "../config.js";
import type { PerformanceSnapshot, UploadResult, VideoScript } from "../types.js";

function getAuthedClient() {
  const oauth2Client = new google.auth.OAuth2(config.ytClientId, config.ytClientSecret);
  oauth2Client.setCredentials({ refresh_token: config.ytRefreshToken });
  return oauth2Client;
}

export async function uploadShort(
  filePath: string,
  script: VideoScript
): Promise<UploadResult> {
  const auth = getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: script.onScreenTitle.slice(0, 95) + " #Shorts",
        description: script.description,
        tags: script.tags,
        categoryId: "27", // Education
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
        // Required disclosure per YouTube's "Altered or Synthetic Content" policy.
        // NOTE: as of this writing the disclosure flag is set via YouTube Studio's
        // "Content -> Show more -> Altered content" toggle or the newer API field;
        // verify the exact field name in the current Data API v3 docs before relying
        // on this, since Google has been rolling this out gradually.
      },
    },
    media: { body: createReadStream(filePath) },
  });

  const videoId = res.data.id!;
  return { youtubeVideoId: videoId, url: `https://www.youtube.com/shorts/${videoId}` };
}

export async function getPerformance(videoId: string): Promise<PerformanceSnapshot> {
  const auth = getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });
  const res = await youtube.videos.list({ part: ["statistics"], id: [videoId] });
  const stats = res.data.items?.[0]?.statistics;
  return {
    youtubeVideoId: videoId,
    views: Number(stats?.viewCount ?? 0),
    likes: Number(stats?.likeCount ?? 0),
    // YouTube Analytics API (separate from Data API) is needed for true
    // avg-view-duration; wire that in once you have Analytics API scope enabled.
    avgViewDurationSeconds: 0,
    capturedAt: new Date().toISOString(),
  };
}
