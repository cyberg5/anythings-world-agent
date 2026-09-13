import { config } from "./config.js";
import { pickNextTopic } from "./agents/trendAgent.js";
import { buildResearchDossier } from "./agents/researchAgent.js";
import { writeScript } from "./agents/scriptAgent.js";
import { produceVideo } from "./agents/productionAgent.js";
import { runQA } from "./agents/qaAgent.js";
import { publish } from "./agents/uploadAgent.js";
import { getPublishedVideoCount } from "./services/supabase.js";
import type { VideoFormat } from "./types.js";

async function runOnce(attempt: number, format: VideoFormat): Promise<boolean> {
  console.log(`\n=== Run attempt ${attempt} (${format}) ===`);

  const candidate = await pickNextTopic(format);
  console.log("Topic:", candidate.topic);

  const dossier = await buildResearchDossier(candidate);
  console.log(`Sourced ${dossier.facts.length} verified facts.`);

  const script = await writeScript(dossier);
  console.log("Script written:", script.onScreenTitle);

  const video = await produceVideo(script);
  console.log("Video rendered:", video.filePath, `(${video.durationSeconds}s)`);

  const qa = await runQA(video);
  if (!qa.passed) {
    console.warn("QA rejected this video:", qa.reasons);
    return false;
  }

  const result = await publish(video);
  console.log("Published:", result.url);
  return true;
}

async function main() {
  let published = 0;
  let attempts = 0;
  const maxAttempts = config.videosPerRun * 3; // allow retries for QA-rejected attempts

  // Every Nth video overall is long-form; the rest are Shorts. Checked once
  // at the start — a long-form pick still gets retried as long-form on
  // QA-rejected attempts within this same run.
  const publishedSoFar = await getPublishedVideoCount();
  const format: VideoFormat =
    config.longFormEveryN > 0 && (publishedSoFar + 1) % config.longFormEveryN === 0 ? "long" : "short";
  console.log(`Total published so far: ${publishedSoFar}. This run targets: ${format}-form.`);

  while (published < config.videosPerRun && attempts < maxAttempts) {
    attempts++;
    try {
      if (await runOnce(attempts, format)) published++;
    } catch (err) {
      console.error("Attempt failed:", err);
    }
  }

  console.log(`\nDone. Published ${published}/${config.videosPerRun} videos this run.`);

  // A "successful" run that published nothing is a failure — surface it as
  // a red X in GitHub Actions instead of a misleading green check, so you
  // actually notice when something's silently going wrong.
  if (published < config.videosPerRun) {
    throw new Error(
      `Only published ${published}/${config.videosPerRun} videos after ${attempts} attempts. See warnings above for why each attempt was rejected or failed.`
    );
  }
}

main().catch((err) => {
  console.error("Fatal error in orchestrator:", err);
  process.exit(1);
});
