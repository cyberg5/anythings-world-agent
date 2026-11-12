import { config } from "../config.js";
import { uploadShort, getPerformance } from "../services/youtube.js";
import { uploadToTikTok } from "../services/tiktok.js";
import { uploadToInstagram } from "../services/instagram.js";
import { recordPublishedVideo, recordPerformance } from "../services/supabase.js";
import type { ProducedVideo, UploadResult } from "../types.js";

export async function publish(video: ProducedVideo): Promise<UploadResult> {
  let result: UploadResult;
  switch (config.platform) {
    case "tiktok":
      result = await uploadToTikTok(video);
      break;
    case "instagram":
      result = await uploadToInstagram(video);
      break;
    default:
      result = await uploadShort(video.filePath, video.script);
  }
  await recordPublishedVideo(video.script, result);
  return result;
}

/**
 * Call this periodically (see README — a second, less-frequent scheduled job)
 * for videos published in the last N days, to feed the trend agent's
 * getTopPerformingTopics() feedback loop. YouTube only for now.
 */
export async function snapshotPerformance(youtubeVideoId: string): Promise<void> {
  const snap = await getPerformance(youtubeVideoId);
  await recordPerformance(snap);
}
