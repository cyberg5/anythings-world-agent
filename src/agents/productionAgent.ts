import path from "path";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { synthesizeSpeech } from "../services/tts.js";
import { fetchStockImage } from "../services/visuals.js";
import { buildSegmentClip, concatClips, applyBrandingPass } from "../branding/template.js";
import { config } from "../config.js";
import type { ProducedVideo, VideoScript } from "../types.js";

const LOGO_PATH = path.resolve("assets/logo_watermark_256.png");

export async function produceVideo(script: VideoScript): Promise<ProducedVideo> {
  const workDir = await mkdtemp(path.join(tmpdir(), "atw-video-"));
  try {
    const clipPaths: string[] = [];
    let totalDuration = 0;

    for (const [i, seg] of script.narrationSegments.entries()) {
      const audioPath = path.join(workDir, `narration_${i}.mp3`);
      const imagePath = path.join(workDir, `image_${i}.jpg`);
      const clipPath = path.join(workDir, `segment_${i}.mp4`);

      await synthesizeSpeech(seg.text, audioPath);
      await fetchStockImage(seg.visualQuery, imagePath);
      await buildSegmentClip({
        imagePath,
        audioPath,
        durationSeconds: seg.approxSeconds,
        captionText: seg.text,
        outPath: clipPath,
      });

      clipPaths.push(clipPath);
      totalDuration += seg.approxSeconds;
    }

    const mainCut = path.join(workDir, "main_cut.mp4");
    await concatClips(clipPaths, mainCut, workDir);

    const finalPath = path.resolve(`output/${slugify(script.topic)}.mp4`);
    await mkdir(path.dirname(finalPath), { recursive: true }); // output/ may not exist yet (git doesn't track empty dirs)
    await applyBrandingPass({
      inputPath: mainCut,
      logoPath: LOGO_PATH,
      channelName: config.channelName,
      onScreenTitle: script.onScreenTitle,
      outPath: finalPath,
      workDir,
    });

    return { filePath: finalPath, durationSeconds: totalDuration + 2, script };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}
