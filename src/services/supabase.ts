import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import type { PerformanceSnapshot, UploadResult, VideoScript } from "../types.js";

export const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

export async function isTopicAlreadyUsed(topic: string): Promise<boolean> {
  const { data, error } = await db
    .from("videos")
    .select("id")
    .ilike("topic", topic)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function recordPublishedVideo(
  script: VideoScript,
  upload: UploadResult
): Promise<void> {
  const { error } = await db.from("videos").insert({
    topic: script.topic,
    youtube_video_id: upload.youtubeVideoId,
    url: upload.url,
    description: script.description,
    tags: script.tags,
    sources: script.citedSources,
    published_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function recordPerformance(snap: PerformanceSnapshot): Promise<void> {
  const { error } = await db.from("performance_snapshots").insert({
    youtube_video_id: snap.youtubeVideoId,
    views: snap.views,
    avg_view_duration_seconds: snap.avgViewDurationSeconds,
    likes: snap.likes,
    captured_at: snap.capturedAt,
  });
  if (error) throw error;
}

/** Feed the feedback loop: topics/angles that performed well, to bias future topic selection. */
export async function getTopPerformingTopics(limit = 10): Promise<string[]> {
  const { data, error } = await db
    .from("videos")
    .select("topic, performance_snapshots(views)")
    .order("published_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const scored = (data ?? [])
    .map((row: any) => ({
      topic: row.topic as string,
      views: Math.max(0, ...(row.performance_snapshots ?? []).map((p: any) => p.views ?? 0)),
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit)
    .map((r) => r.topic);
  return scored;
}
