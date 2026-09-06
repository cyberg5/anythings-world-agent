import { db } from "../services/supabase.js";
import { snapshotPerformance } from "../agents/uploadAgent.js";

async function main() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("videos")
    .select("youtube_video_id")
    .gte("published_at", since);
  if (error) throw error;

  for (const row of data ?? []) {
    try {
      await snapshotPerformance(row.youtube_video_id);
      console.log("Snapshotted", row.youtube_video_id);
    } catch (e) {
      console.error("Failed for", row.youtube_video_id, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
